/**
 * The chat answering pipeline, shared by the API route (src/app/api/chat)
 * and the eval harness (npm run evals). Lives outside the route file so
 * scripts can import it without pulling in Next route conventions.
 */
import "server-only";
import { listPets, type PetRow } from "@/db/queries";
import { streamChat, type ChatMessagePart } from "@/lib/model";
import { retrieve } from "@/lib/retrieval";

/**
 * Hard guardrail: the 0.5B model follows scope instructions most of the time
 * but not reliably, so obviously-off-topic requests (code, general knowledge,
 * writing tasks) are refused before the model ever sees them. Deliberately
 * conservative — ambiguous pet questions always reach the model.
 */
const OFF_TOPIC = [
  // code / tech — bare keywords are pet-plausible ("lab", "visit"), so each
  // term is either unambiguous or anchored by a verb
  /\b(javascript|typescript|python|react|reactjs|next\.js|vue|angular|html|css|sql|regex|github|npm|node\.js|api|endpoint|compiler|compile|algorithm|software|coding|programming)\b/i,
  /\b(write|make|create|generate|build|fix|refactor|debug)\b.{0,24}\b(code|coder|coding|program|script|function|component|class|program|website|web ?page|app|algorithm|regex|sql|api|test|unit test)\b/i,
  // general knowledge / trivia / how-to
  /\b(capital of|population of|weather (in|for)|translate|definition of|history of|lyrics|recipe|cooking|how many (people|countries|seconds)|tallest|largest (country|ocean|planet))\b/i,
  // creative / chatbot-elsewhere asks ("story" intentionally excluded — users
  // legitimately ask for the story behind a diagnosis)
  /\b(poem|haiku|joke|essay|song lyrics|limerick|roleplay|role[- ]play|pretend to be|act as a|write me|tell me a joke|write a (letter|email|blog))\b/i,
  // math homework
  /\b(solve|simplify|factor|derivative|integral|graph)\b.{0,20}\b(equation|integral|derivative|sqrt|\d+ *[-+*/^] *(\d+|x)|for x)\b/i,
  /\bwhat is (\d+|what)\b.{0,4}[-+*/x^].{0,8}\d+/i,
]

export function isOffTopic(text: string): boolean {
  return OFF_TOPIC.some((re) => re.test(text))
}

export function refusalText(name: string): string {
  return `I can only answer questions about ${name}'s records. Try asking about ${name}'s visits, vaccines, lab results, or medications.`
}

export function buildSystemPrompt(
  scope: PetRow[],
  lines: string[],
  dropped: number,
): string {
  const petBlocks = scope.map((pet) => [
    `PET: ${pet.name} (${pet.species}${pet.breed ? `, ${pet.breed}` : ""})`,
    pet.dateOfBirth ? `Born: ${pet.dateOfBirth}` : "",
    pet.weightG ? `Weight: ${(pet.weightG / 1000).toFixed(1)} kg` : "",
    pet.notes ? `Owner notes: ${pet.notes}` : "",
  ].filter(Boolean).join("\n"));
  const firstName = scope[0]?.name ?? "your pet";
  return [
    "You are Nova, the Novellia Pets assistant. You only answer questions about the pets and EVIDENCE lines below. You are not a general chatbot, coding assistant, or search engine.",
    `If the question is not about these pets' health records (code, recipes, general knowledge, writing, math, role-play), reply exactly: I can only answer questions about ${firstName}'s records. Try asking about ${firstName}'s visits, vaccines, lab results, or medications.`,
    "Anything that could be about a pet's health, care, or records is in scope: answer from the evidence where possible.",
    "To answer: find the evidence line that states the fact and repeat exactly what it says, including the date on that line. Never use outside knowledge. Never do math, convert units, or guess years.",
    "Answer in one or two short sentences. If no evidence line states the answer, say you do not have that information and suggest asking the veterinarian.",
    "Never give dosing advice beyond what is recorded. This is not veterinary advice.",
    "",
    "Example evidence line: - Luna: Vaccination on 2026-03-14: Rabies (1-year booster). Details: Lot: RB-88213; Next due: 2027-03-14",
    "Example question: When is the next rabies vaccine due?",
    "Example answer: The records say the next rabies vaccine is due 2027-03-14.",
    "",
    `Example question: What was ${firstName}'s blood pressure? (no evidence line mentions blood pressure)`,
    `Example answer: The records don't include ${firstName}'s blood pressure. Please ask the veterinarian.`,
    "",
    "Example question: Write me a JavaScript function.",
    `Example answer: I can only answer questions about ${firstName}'s records. Try asking about ${firstName}'s visits, vaccines, lab results, or medications.`,
    "",
    ...petBlocks,
    "",
    "EVIDENCE (most relevant first):",
    lines.length ? lines.join("\n") : "(no matching records)",
    dropped > 0 ? `(${dropped} older/lower-ranked records are not shown.)` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Answer one question through the full production pipeline: guardrail check →
 * retrieval (evidence pack + fast-path answers) → model. Undefined petId (or
 * "all") means all-pets scope. Returns the refusal immediately for off-topic
 * questions (no model call).
 */
export async function answerQuestion(opts: {
  petId?: string; // undefined = all-pets scope ("all" also accepted)
  question: string;
  history?: ChatMessagePart[];
  onProgress?: (status: string, percent: number) => void;
}): Promise<{ text: string; refused: boolean; fast: boolean; ms: number }> {
  const started = Date.now();
  if (isOffTopic(opts.question)) {
    const pets = await listPets();
    return { text: refusalText(pets[0]?.name ?? "your pet"), refused: true, fast: false, ms: Date.now() - started };
  }
  const got = await retrieve(opts.question, opts.petId);
  if (got.fastAnswer) return { text: got.fastAnswer, refused: false, fast: true, ms: Date.now() - started };
  const messages: ChatMessagePart[] = [
    { role: "system", content: buildSystemPrompt(got.scope, got.lines, got.dropped) },
    ...(opts.history ?? []),
    { role: "user", content: opts.question },
  ];
  const text = await streamChat(messages, () => {}, opts.onProgress);
  return { text: text.trim(), refused: false, fast: false, ms: Date.now() - started };
}
