/**
 * Downloads the model into TRANSFORMERS_CACHE_DIR (default .models) so the
 * Docker image bakes it in and pods answer the first question without a
 * ~480MB cold download.
 */
process.env.TRANSFORMERS_CACHE_DIR ||= ".models";

const { env, AutoModelForCausalLM, AutoTokenizer } = await import(
  "@huggingface/transformers"
);
env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
env.allowLocalModels = false;

console.log("downloading", MODEL_ID);
await AutoTokenizer.from_pretrained(MODEL_ID);
await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
  dtype: (process.env.MODEL_DTYPE || "q4f16") as "q4f16",
});
console.log("model cached in", env.cacheDir);
process.exit(0);
