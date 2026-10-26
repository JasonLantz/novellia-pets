/**
 * Nova chat eval harness — run with `npm run evals`.
 *
 * Grades the production answering pipeline (guardrail → system prompt from
 * live DB records → Qwen2.5-0.5B) against the golden questions in
 * evals/cases.mts. Deterministic regex assertions; exits 1 on any failure so
 * it can gate CI.
 *
 * Modes:
 *   npm run evals              in-process (boots its own model + DB; works
 *                              whether or not the dev server is running)
 *   EVAL_BASE_URL=http://host:port npm run evals
 *                              against a running server's /api/chat (fast:
 *                              reuses the server's warm model; needs a
 *                              server with a writable DB)
 *
 * Flags: --filter <id-substring>  only run matching case ids
 *        --json                   machine-readable output to stdout
 */
process.env.TRANSFORMERS_CACHE_DIR ||= ".models";

// In-process mode gets its own DB copy: eval answers must never pollute the
// dev app's chat history, and vice versa (server mode intentionally uses the
// live DB — it is the live API being tested).
if (!process.env.EVAL_BASE_URL && !process.env.SQLITE_PATH && !process.env.DATABASE_URL) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const src = path.join(process.cwd(), "data", "novellia.db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novellia-evals-"));
  if (fs.existsSync(src)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = src + suffix;
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, "novellia.db" + suffix));
    }
  }
  process.env.SQLITE_PATH = path.join(dir, "novellia.db");
  // best-effort cleanup on normal exit
  process.on("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp dir, fine if it lingers */
    }
  });
}

interface RunResult {
  id: string;
  pet: string;
  question: string;
  answer: string;
  refused: boolean;
  ms: number;
  pass: boolean;
  failures: string[];
}

const argv = process.argv.slice(2);
const filterIdx = argv.indexOf("--filter");
const FILTER = filterIdx >= 0 ? argv[filterIdx + 1] : undefined;
/** Comma-separated substrings: --filter "a,b" keeps ids containing either. */
function matchFilter(id: string): boolean {
  if (!FILTER) return true;
  return FILTER.split(",").some((f) => id.includes(f.trim()));
}
const JSON_OUT = argv.includes("--json");
const BASE_URL = process.env.EVAL_BASE_URL;


const say = JSON_OUT
  ? { log: () => {}, write: () => {} }
  : { log: (...a: unknown[]) => console.log(...a), write: (s: string) => process.stdout.write(s) };

/**
 * Build the model-visible history for a case. By default all prior cases run
 * as one conversation (realistic: stale answers sit in the context window).
 * Isolated cases get a fresh context: their own `context` turns only.
 */
function historyFor(
  c: EvalCase,
  runs: RunResult[],
  isolatedIds: Set<string>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (isolatedIds.has(c.id)) {
    for (const ctx of c.context ?? []) {
      out.push({
        role: out.length % 2 === 0 ? "user" : "assistant",
        content: ctx,
      });
    }
    return out;
  }
  for (const r of runs) {
    if (!isolatedIds.has(r.id)) {
      out.push({ role: "user", content: r.question }, { role: "assistant", content: r.answer });
    }
  }
  return out.slice(-6);
}

import { EVAL_CASES, isoDatePattern, type EvalAssertion, type EvalCase } from "./cases.mts";

function mentionsOtherYear(text: string, iso: string): boolean {
  const keep = iso.slice(0, 4);
  return Array.from(text.matchAll(/(?<!\d)20\d\d(?!\d)/g)).some((m) => m[0] !== keep);
}

function grade(res: RunResult, assertions: EvalAssertion[]): string[] {
  const failures: string[] = [];
  const text = res.answer;
  const norm = text.toLowerCase().replace(/[\s*_`>#-]+/g, " ").trim();
  const refusalish =
    res.refused ||
    /can only answer questions about|try asking about .* (visits|vaccines)/i.test(norm);
  for (const a of assertions) {
    switch (a.kind) {
      case "mustMatch":
        if (!a.pattern.test(text) && !a.pattern.test(norm)) failures.push(a.why);
        break;
      case "mustNotMatch":
        if (a.pattern.test(text) || a.pattern.test(norm)) failures.push(a.why);
        break;
      case "dateOnly": {
        const re = isoDatePattern(a.iso);
        if (!re.test(text) && !re.test(norm)) failures.push(a.why);
        else if (mentionsOtherYear(text, a.iso)) failures.push(`${a.why} (answer contains another year)`);
        break;
      }
      case "refused":
        if (!refusalish) failures.push("expected off-topic refusal, got a normal answer");
        break;
      case "notRefused":
        if (refusalish) failures.push(a.why);
        break;
    }
  }
  return failures;
}

async function main() {
  const cases0 = EVAL_CASES;
  const cases = FILTER ? cases0.filter((c) => matchFilter(c.id)) : cases0;
  if (cases.length === 0) {
    console.error(`no eval cases match --filter ${FILTER}`);
    process.exit(2);
  }

  // Pet name → id (seeds the demo DB in both modes so cases can rely on it).
  const { ensureSeed, listPets } = await import("@/db/queries");
  await ensureSeed();
  const pets = await listPets();
  const petId = new Map(pets.map((p) => [p.name, p.id]));
  for (const c of cases) {
    if (!petId.has(c.pet)) {
      console.error(`pet "${c.pet}" not found in DB`);
      process.exit(2);
    }
  }

  const isolatedIds = new Set(cases.filter((c) => c.isolated).map((c) => c.id));

  // Warm the model once before timing any case (in-process mode only —
  // the server mode relies on the server's own instrumentation warmup).
  if (!BASE_URL) {
    const { warmupModel } = await import("@/lib/model");
    say.write("warming model… ");
    let lastPct = -1;
    await warmupModel((s, p) => {
      if (s === "downloading" && p >= lastPct + 25) {
        lastPct = p;
        say.write(`${p}% `);
      }
    });
    say.log("ready");
  }

  const runs: RunResult[] = [];
  const startedAll = Date.now();
  for (const [i, c] of cases.entries()) {
    const prefix = JSON_OUT ? "" : `[${String(i + 1).padStart(2)}/${cases.length}] ${c.id.padEnd(24)}`;
    say.write(`${prefix} …`);
    const attempts = Math.max(1, c.attempts ?? 1);
    let run: RunResult | null = null;
    for (let a = 0; a < attempts; a++) {
      let answer: string;
      let refused: boolean;
      let ms: number;
      if (BASE_URL) {
        const r0 = Date.now();
        answer = await askServer(c, petId, isolatedIds);
        ms = Date.now() - r0;
        refused = /only answer questions about/i.test(answer);
      } else {
        const { answerQuestion } = await import("@/lib/chat-core");
        const res = await answerQuestion({
          petId: c.scope === "all" ? undefined : petId.get(c.pet)!,
          question: c.question,
          history: historyFor(c, runs, isolatedIds),
        });
        answer = res.text;
        refused = res.refused;
        ms = res.ms;
      }
      const candidate: RunResult = {
        id: c.id,
        pet: c.pet,
        question: c.question,
        answer,
        refused,
        ms,
        pass: true,
        failures: [],
      };
      candidate.failures = grade(candidate, c.assertions);
      candidate.pass = candidate.failures.length === 0;
      run = candidate;
      if (candidate.pass) break;
      if (attempts > 1 && a < attempts - 1) say.write("retry… ");
    }
    runs.push(run!);
    if (!JSON_OUT) {
      say.write(` ${run!.pass ? "PASS" : "FAIL"} (${(run!.ms / 1000).toFixed(1)}s)\n`);
      if (!run!.pass) {
        say.log(`    answer: ${run!.answer.slice(0, 160)}`);
        for (const f of run!.failures) say.log(`    ✗ ${f}`);
      }
    }
  }

  const passed = runs.filter((r) => r.pass).length;
  const summary = {
    total: runs.length,
    passed,
    failed: runs.length - passed,
    seconds: Number(((Date.now() - startedAll) / 1000).toFixed(1)),
    mode: BASE_URL ? "server" : "in-process",
    results: runs.map(({ answer, ...r }) => ({ ...r, answer: answer.slice(0, 300) })),
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    say.log(
      `\n${passed}/${runs.length} passed in ${summary.seconds}s (${summary.mode}${BASE_URL ? ` @ ${BASE_URL}` : ""})`,
    );
    const failed = runs.filter((r) => !r.pass);
    if (failed.length) say.log(`failed: ${failed.map((r) => r.id).join(", ")}`);
  }
  process.exit(passed === runs.length ? 0 : 1);
}

/** Server mode: one fresh conversation per case via /api/chat SSE stream. */
async function askServer(
  c: EvalCase,
  petId: Map<string, string>,
  isolatedIds: Set<string>,
): Promise<string> {
  const isolated = isolatedIds.has(c.id);
  void isolated;
  const messages: unknown[] = [];
  for (const ctx of c.context ?? []) {
    const role = messages.length % 2 === 0 ? "user" : "assistant";
    messages.push({ id: crypto.randomUUID(), role, parts: [{ type: "text", text: ctx }] });
  }
  messages.push({
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: c.question }],
  });
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ petId: c.scope === "all" ? "all" : petId.get(c.pet), messages }),
  });
  if (!res.ok || !res.body) throw new Error(`/api/chat → ${res.status}`);
  let text = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const d = JSON.parse(line.slice(6)) as { type?: string; delta?: string };
        if (d.type === "text-delta") text += d.delta ?? "";
        if (d.type === "error") throw new Error(d.delta ?? "stream error");
      } catch {
        /* ignore non-JSON lines */
      }
    }
  }
  return text;
}

main().catch((err) => {
  console.error("eval harness crashed:", err);
  process.exit(2);
});
