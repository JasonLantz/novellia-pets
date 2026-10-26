import "server-only";
/**
 * Server-side language model backed by transformers.js running
 * Qwen2.5-0.5B-Instruct (quantized) on CPU.
 *
 * Why server-side (vs the HF tutorial's in-browser WebGPU demo):
 * - the transformers.js Node build pulls onnxruntime-node, which must not be
 *   bundled into client chunks;
 * - the ~480MB model download belongs on the server (cached under .models/ in
 *   dev, baked into the image in prod);
 * - the model needs the database to ground answers in the pet's real records,
 *   which is a server concern.
 *
 * The quantized ONNX export lives at onnx-community/Qwen2.5-0.5B-Instruct
 * (transformers.js-compatible mirror of Qwen/Qwen2.5-0.5B-Instruct).
 */

export const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";

export interface ChatMessagePart {
  role: "system" | "user" | "assistant";
  content: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any;

let pipelinePromise: Promise<Pipeline> | null = null;

export type ProgressCallback = (status: string, percent: number) => void;

async function loadPipeline(onProgress?: ProgressCallback): Promise<Pipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR || ".models";
      env.allowLocalModels = false;
      onProgress?.("loading", 0);
      const pipe = await pipeline("text-generation", MODEL_ID, {
        dtype: (process.env.MODEL_DTYPE || "q4f16") as "q4f16",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            onProgress?.("downloading", Math.round(p.progress));
          }
        },
      });
      onProgress?.("ready", 100);
      return pipe;
    })().catch((err) => {
      pipelinePromise = null; // allow retry after a transient failure
      throw err;
    });
  }
  return pipelinePromise;
}

/** Kick-start the model download/load (idempotent; safe to call at boot). */
export function warmupModel(onProgress?: ProgressCallback): Promise<Pipeline> {
  return loadPipeline(onProgress);
}

export function isModelWarming(): boolean {
  return pipelinePromise !== null;
}

/**
 * Stream a chat completion; onChunk receives finalized text pieces.
 * Uses transformers.js' streaming callback so tokens surface as they generate.
 */
export async function streamChat(
  messages: ChatMessagePart[],
  onChunk: (text: string) => void,
  onProgress?: ProgressCallback,
): Promise<string> {
  const pipe = await loadPipeline(onProgress);
  let full = "";
  // The raw token streamer decodes the echoed ChatML template too
  // ("system\n<prompt>assistant\n"). Track where the real reply begins:
  // generation starts right after the final "assistant\n" marker.
  let consumed = 0;
  const stripTemplate = (accum: string) => {
    const marker = "assistant\n";
    const i = accum.lastIndexOf(marker);
    return i >= 0 ? accum.slice(i + marker.length) : "";
  };
  const outputs = await pipe(messages, {
    max_new_tokens: 256,
    do_sample: false, // greedy: extraction-quality answers, reproducible evals
    repetition_penalty: 1.15,
    streamer: {
      put: (value: bigint[][]) => {
        if (!value?.length) return;
        const text = pipe.tokenizer.decode(value[0], { skip_special_tokens: true });
        if (!text) return;
        full += text;
        const clean = stripTemplate(full);
        if (clean.length > consumed) {
          onChunk(clean.slice(consumed));
          consumed = clean.length;
        }
      },
      end: () => {},
    },
  });
  // Fallback: if the streamer never fired, emit the pipeline result instead.
  if (!full) {
    const last = outputs?.at?.(-1);
    const text =
      typeof last?.generated_text === "string"
        ? last.generated_text
        : last?.generated_text?.at?.(-1)?.content ?? "";
    if (text) {
      full = text;
      onChunk(text);
    }
  }
  const answer = full ? stripTemplate(full).trim() : full.trim();
  return answer;
}
