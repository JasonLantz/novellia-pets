/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (before the first request). Kicks off the Qwen model download/load so the
 * first chat message doesn't wait ~480MB of weights; subsequent requests hit
 * the already-resolved pipeline promise in src/lib/model.ts.
 *
 * Failures are logged, never fatal: a broken model download must not take the
 * records app down. The chat route retries the load on demand.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WARM_MODEL === "0") {
    console.log("[novellia] model warmup skipped (WARM_MODEL=0)");
    return;
  }
  const { warmupModel } = await import("@/lib/model");
  const started = Date.now();
  let lastPct = -1;
  warmupModel((status, percent) => {
    if (status === "downloading" && percent >= lastPct + 20) {
      lastPct = percent;
      console.log(`[novellia] model download ${percent}%`);
    }
  })
    .then(() => {
      console.log(
        `[novellia] model ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    })
    .catch((err) => {
      console.error(
        "[novellia] model warmup failed — chat will retry on first message:",
        err instanceof Error ? err.message : err,
      );
    });
}
