import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { listChatMessages, saveChatMessage, getPet } from "@/db/queries";
import { streamChat, MODEL_ID, type ChatMessagePart } from "@/lib/model";
import { isOffTopic, refusalText, buildSystemPrompt } from "@/lib/chat-core";
import { retrieve } from "@/lib/retrieval";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages: UIMessage[];
    petId?: string;
  };
  const petId = body.petId; // undefined or "all" = every pet
  const scoped = petId && petId !== "all" ? await getPet(petId) : null;
  if (petId && petId !== "all" && !scoped) {
    return Response.json({ error: "pet not found" }, { status: 404 });
  }
  const threadId = scoped?.id ?? "all"; // chat history thread id ("all" = global thread)

  const incoming = body.messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.id !== "undefined",
  );
  // persist the latest user message
  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  const userText =
    lastUser?.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n") ?? "";
  if (lastUser && userText) {
    await saveChatMessage(threadId, "user", userText);
  }

  // Refuse obviously-off-topic asks without spending GPU time on them; the
  // refusal is streamed like a normal reply so it also lands in history.
  if (userText && isOffTopic(userText)) {
    const refusal = refusalText(scoped?.name ?? "your pet");
    await saveChatMessage(threadId, "assistant", refusal);
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: refusal });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish-step" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  const [history, got] = await Promise.all([
    listChatMessages(threadId, 4),
    retrieve(userText || "", petId),
  ]);
  if (got.fastAnswer) {
    const fast = createUIMessageStream({
      execute: async ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: "start-step" });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: got.fastAnswer! });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish-step" });
      },
    });
    await saveChatMessage(threadId, "assistant", got.fastAnswer);
    return createUIMessageStreamResponse({ stream: fast });
  }
  const modelMessages: ChatMessagePart[] = [
    { role: "system", content: buildSystemPrompt(got.scope, got.lines, got.dropped) },
    ...history
      .filter((h) => h.role === "user" || h.role === "assistant")
      .map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
  ];
  // ensure the just-saved user turn is represented (history was read concurrently)
  if (
    userText &&
    modelMessages[modelMessages.length - 1]?.content !== userText
  ) {
    modelMessages.push({ role: "user", content: userText });
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start-step" });
      let first = true;
      let id = "";
      try {
        const full = await streamChat(
          modelMessages,
          (chunk) => {
            if (first) {
              first = false;
              id = crypto.randomUUID();
              writer.write({ type: "text-start", id });
            }
            writer.write({ type: "text-delta", id, delta: chunk });
          },
          (status, percent) => {
            writer.write({
              type: "data-modelStatus",
              id: "model-status",
              data: { status, percent, model: MODEL_ID },
            });
          },
        );
        if (!first) writer.write({ type: "text-end", id });
        if (full) {
          await saveChatMessage(threadId, "assistant", full.trim());
        }
      } catch (err) {
        writer.write({
          type: "error",
          errorText:
            err instanceof Error ? err.message : "Model failed to respond",
        });
      }
      writer.write({ type: "finish-step" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
