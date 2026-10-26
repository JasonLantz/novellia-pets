# Pet Q&A over SQLite — Retrieval-Grounded Nova 実装計画 / Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Nova answer questions about *the pets* (plural) from the SQLite database by **retrieving a small, relevant evidence set from SQL for each question** — instead of dumping every record into the prompt — and answer count/date questions deterministically in SQL without ever consulting the 0.5B model.

**Architecture:** Question → pure `parseIntent()` (record types, pet mention, keywords, date window, aggregate flag) → SQL pre-filter (`listRecords` with type/date/pet filters) → pure `buildEvidencePack()` scores/truncates candidates → small prompt for Qwen2.5-0.5B. Aggregates ("how many…", "next vaccine due") are answered directly from SQL/JSON parsing and skip the model. Cross-pet scope works when no pet is selected or when the question names a different pet.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM over better-sqlite3 (dev) / Postgres (deployed), `@huggingface/transformers` Qwen2.5-0.5B (unchanged), Vercel AI SDK streaming (unchanged), `node:test` via `tsx` for unit tests (new), existing `npm run evals` harness as the integration gate.

---

## Where we are (read this first)

**Q&A already exists.** `src/app/api/chat/route.ts` answers questions about one selected pet: it loads **all** of that pet's `medical_records` rows (`route.ts:55-58`, `chat-core.ts:139-142`) and formats every one into the system prompt (`chat-core.ts:78-117`). A regex guardrail refuses off-topic asks (`chat-core.ts:55-72`). The eval suite (`evals/`) grades golden questions.

**What is wrong with it** — these are the things this plan fixes:

1. **No retrieval.** Every question re-sends the pet's entire record table. The eval file itself documents the damage: "answers drift into the reply" (`cases.mts:66`), "'2022' from Luna's spay record leaked" into an answer about Biscuit (`cases.mts:117-119`). A 0.5B model gets *worse* with more context, and prompt growth costs latency on the RPi where this deploys.
2. **No DB-level question answering.** "How many lab results does Luna have?" forces a model that is explicitly told "Never do math" (`chat-core.ts:93`) to count strings. SQL can answer count/date-range/next-due questions exactly, for free, in milliseconds.
3. **Single-pet only.** `/api/chat` 400s without `petId` (`route.ts:14-16`). You cannot ask "how many vaccinations across all pets?" and a question about Biscuit typed while Luna is selected answers about Luna.
4. **Half-finished change in the tree:** `src/lib/model.ts` has an uncommitted switch to greedy decoding (`do_sample: true → false`, `temperature: 0.7 → 0`, `top_p` removed) — coherent, but leaves a redundant `temperature: 0` and a formatting slip (`end: () => { }`). Task 0 pins it down and lands it.

Scale today is tiny (3 pets, 12 records), so retrieval is **not** about volume — it is about prompt hygiene (kill contamination), determinism (aggregates in SQL), and multi-pet scope.

### Conventions to respect

- **This is Next.js 16** — before touching anything in `src/app/` (Tasks 6–7), read `node_modules/next/dist/docs/01-app/` (route handler + page conventions; note the `instant` export used in `src/app/ask/page.tsx`).
- SQLite and Postgres schemas are kept ANSI-compatible by design (`src/db/schema.ts` header comment). Any new SQL in `src/db/queries.ts` must use drizzle builders or ANSI SQL only.
- `src/db/queries.ts` and `src/lib/*` modules import `"server-only"`. Verified: they import fine under `tsx` (both `node --import tsx --test` and the evals harness), so unit/integration tests can import them. Modules under `src/lib/` that are pure (intent, evidence) must **not** import `server-only` — they are `import type`-only consumers of `@/db/schema`.
- DB state in tests: set `process.env.SQLITE_PATH` to a temp file **before** the dynamic `import("@/db/queries")` (the connection is cached at module scope).
- All commands below were verified to work on this machine (Node 24.5.0).

### Alternatives considered and rejected

| Option | Why rejected |
| --- | --- |
| **Text-to-SQL** (model writes SQL) | A 0.5B model will emit broken and adversarial SQL; the DB is the app's sensitive heart. Retrieval stays behind whitelisted, parameterized query functions. |
| **LLM tool-calling / function calling** | Unreliable JSON at this model size; the same slots (types, window, pet) are parsed deterministically in ~100 lines of rules we can unit-test. |
| **Embeddings / sqlite-vec RAG** | New native dep + a second ONNX model on a memory-constrained RPi, for 12 records. Keyword/type/date retrieval is strictly better here. Revisit trigger: >~200 records per pet, or evals showing keyword retrieval misses synonyms users actually type. |
| **Hosted LLM** | Local inference is a deliberate product value (private medical records — README "What's inside"). Out of scope. |
| **LangChain/LlamaIndex** | Heavyweight frameworks for a pipeline that is three pure functions. |

### Definition of done

```bash
npm test                    # unit + integration tests green
npm run evals               # ALL cases pass (existing 15 + 5 new), in-process mode
npm run evals -- --filter agg   # new aggregate cases pass with attempts: 1 (deterministic)
npm run lint && npm run evals:typecheck
npm run dev  # manual: /ask → "All pets" → "When is Biscuit's next vaccine due?" → 2027-05-11
```

---

## Task 0: Land the decoding change (greedy, complete)

The uncommitted diff already switches to greedy decoding (`do_sample: false`) — the right call for factual extraction — but leaves a redundant `temperature: 0` (ignored when `do_sample: false`) and a formatting slip. Pin the config down and land it.

**Files:**
- Modify: `src/lib/model.ts:86-103`

**Step 1: Make the config coherent**

Replace the generation options block:

```ts
  const outputs = await pipe(messages, {
    max_new_tokens: 256,
    do_sample: false, // greedy: extraction-quality answers, reproducible evals
    repetition_penalty: 1.15,
    streamer: {
      put: (value: bigint[][]) => {
```

and fix the stub: `end: () => { }` → `end: () => {},`.

**Step 2: Verify determinism actually improved**

```bash
npm run evals -- --filter luna-lab-values   # pass 1
npm run evals -- --filter luna-lab-values   # pass 2 — same behavior expected
```
Expected: `1/1 passed` both times (greedy makes the case reproducible; it was `attempts: 2` before).

**Step 3: Full regression + commit**

```bash
npm run evals
git add src/lib/model.ts
git commit -m "feat(model): finalize greedy decoding (drop redundant temperature under do_sample:false)"
```

---

## Task 1: Unit-test harness

**Files:**
- Modify: `package.json:5-19` (scripts)
- Create: `tests/smoke.test.ts`

**Step 1: Add the test script**

In `package.json` scripts, after `"evals:typecheck"`:

```json
"test": "tsx --test \"tests/*.test.ts\"",
```

**Step 2: Write the smoke test**

`tests/smoke.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("harness works", () => {
  assert.equal(1 + 1, 2);
});
```

**Step 3: Run it**

```bash
npm test
```
Expected: `ℹ pass 1` / `ℹ fail 0`. (This exact invocation was verified on Node 24.5.0; passing a bare directory to `tsx --test` does **not** work — keep the glob.)

**Step 4: Commit**

```bash
git add package.json tests/smoke.test.ts
git commit -m "test: node:test harness via tsx"
```

---

## Task 2: `src/lib/intent.ts` — question → bounded intent (pure)

The question understanding step: no DB, no model, no `server-only` import. Only `import type` from the schema (erased at runtime). This is the module all retrieval decisions come from, so it is table-driven unit tested.

**Files:**
- Create: `src/lib/intent.ts`
- Test: `tests/intent.test.ts`

**Step 1: Write the failing tests**

`tests/intent.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "@/lib/intent";

const TODAY = new Date("2026-10-25T12:00:00Z");
const PETS = ["Luna", "Miso", "Biscuit"];

test("vaccination wording maps to type", () => {
  const i = parseIntent("When was Luna's rabies booster?", PETS, TODAY);
  assert.deepEqual(i.types, ["vaccination"]);
  assert.equal(i.petMention, "Luna");
});

test("multiple type words yield multiple types", () => {
  const i = parseIntent("Any recent bloodwork or meds for Miso?", PETS, TODAY);
  assert.ok(i.types.includes("lab") && i.types.includes("prescription"));
});

test("explicit year bounds the window", () => {
  const i = parseIntent("What happened in 2025?", PETS, TODAY);
  assert.equal(i.from, "2025-01-01");
  assert.equal(i.to, "2025-12-31");
});

test("'last year' relative to injected today", () => {
  const i = parseIntent("checkups last year?", PETS, TODAY);
  assert.equal(i.from, "2025-01-01");
  assert.equal(i.to, "2025-12-31");
});

test("'last N months' sets a rolling lower bound", () => {
  const i = parseIntent("visits in the last 6 months", PETS, TODAY);
  assert.equal(i.from, "2026-04-25");
  assert.equal(i.to, null);
});

test("how many → count aggregate", () => {
  assert.equal(parseIntent("How many vaccines does Luna have?", PETS, TODAY).aggregate, "count");
});

test("next due → next-due aggregate", () => {
  assert.equal(parseIntent("When is Biscuit's next vaccine due?", PETS, TODAY).aggregate, "next-due");
});

test("past-tense receipt question is NOT next-due (guards the biscuit-rhdv2 eval)", () => {
  // exact question text from evals/cases.mts — mentions "next due" while
  // grading for the ADMINISTERED date; must not take the next-due fast path
  const i = parseIntent(
    "When did Biscuit receive the RHDV2 vaccine (the date it was given, not the next due date)?",
    PETS,
    TODAY,
  );
  assert.equal(i.aggregate, null);
});

test("pet mention wins on longest name, word-bounded", () => {
  assert.equal(parseIntent("Is Biscuit sick?", ["I", "Biscuit"], TODAY).petMention, "Biscuit");
  assert.equal(parseIntent("Who is Mi?", PETS, TODAY).petMention, null);
});

test("keywords drop stopwords and short tokens", () => {
  const i = parseIntent("What was the WBC value?", PETS, TODAY);
  assert.ok(i.keywords.includes("wbc"));
  assert.ok(!i.keywords.includes("what"));
});

test("no signals at all yields an open intent", () => {
  const i = parseIntent("how is it going", PETS, TODAY);
  assert.deepEqual(i.types, []);
  assert.equal(i.from, null);
  assert.equal(i.aggregate, null);
});
```

**Step 2: Run, verify failure**

```bash
npm test
```
Expected: FAIL — `Cannot find module '@/lib/intent'`.

**Step 3: Implement**

`src/lib/intent.ts`:

```ts
/**
 * Question understanding for Nova: maps a question to a bounded retrieval
 * intent. Pure — no DB, no model, no "server-only" (unit-tested directly).
 * All parsing is rule-based on purpose: a 0.5B model cannot be trusted to
 * plan queries, and every rule here is exercised in tests/intent.test.ts.
 */
import type { RecordType } from "@/db/schema";

export type Aggregate = "count" | "next-due" | null;

export interface Intent {
  types: RecordType[]; // [] = any type
  petMention: string | null; // exact stored pet name, if the question names one
  keywords: string[]; // content tokens for evidence scoring
  from: string | null; // inclusive lower bound on authoredAt (ISO date)
  to: string | null; // inclusive upper bound on authoredAt (ISO date)
  aggregate: Aggregate;
}

const TYPE_SYNONYMS: Array<[RecordType, RegExp]> = [
  ["vaccination", /\b(vaccin\w*|shots?|booster|rabies|dhpp|fvrcp|rhdv2|lyme)\b/i],
  ["lab", /\b(labs?|labwork|bloodwork|blood|cbc|chemistry|panel|sdma|creatinine|wbc|urinalysis)\b/i],
  ["prescription", /\b(prescriptions?|meds?|medications?|doses?|dosage|refills?|apoquel|renal diet|rx)\b/i],
  ["visit", /\b(visits?|checkups?|check-ups?|appointments?|exams?|wellness)\b/i],
  ["document", /\b(documents?|papers?|discharge|summaries?)\b/i],
];

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "is", "are", "was", "were", "do", "does", "did",
  "what", "when", "where", "which", "who", "how", "many", "much", "of", "to",
  "in", "on", "at", "for", "with", "about", "from", "get", "give", "tell",
  "show", "me", "my", "it", "its", "has", "have", "had", "i", "any", "recent",
  "please", "again", "next", "last", "due", "going",
]);

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseIntent(
  question: string,
  petNames: string[],
  today: Date = new Date(),
): Intent {
  const q = question.toLowerCase();

  const types = TYPE_SYNONYMS.filter(([, re]) => re.test(q)).map(([t]) => t);

  // Pet mention: longest name first so "Big Luna" can't be stolen by "Luna";
  // word-bounded so "Mi" never matches inside "Miso".
  let petMention: string | null = null;
  for (const name of [...petNames].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(?<!\\w)${escapeRe(name)}(?!\\w)`, "i").test(question)) {
      petMention = name;
      break;
    }
  }

  // Date window (authoredAt): explicit year > this/last year > last N months.
  let from: string | null = null;
  let to: string | null = null;
  const year = /\b(20\d\d)\b/.exec(q);
  if (year) {
    from = `${year[1]}-01-01`;
    to = `${year[1]}-12-31`;
  } else if (/\b(this|current) year\b/.test(q)) {
    from = `${today.getFullYear()}-01-01`;
    to = `${today.getFullYear()}-12-31`;
  } else if (/\blast year\b/.test(q)) {
    from = `${today.getFullYear() - 1}-01-01`;
    to = `${today.getFullYear() - 1}-12-31`;
  } else {
    const months = /\blast (\d+) months?\b/.exec(q);
    if (months) {
      const d = new Date(today);
      d.setUTCMonth(d.getUTCMonth() - Number(months[1])); // UTC math: isoDay reads UTC fields
      from = isoDay(d);
    }
  }

  let aggregate: Aggregate = null;
  if (/\bhow many\b/.test(q)) aggregate = "count";
  // Past-tense receipt wording ("when did X receive…") asks for the ADMINISTERED
  // date, not the next-due date — never fast-path it. The exclusion is load-
  // bearing: evals/cases.mts case "biscuit-rhdv2" literally contains the phrase
  // "next due" in its question text while grading for the given date.
  else if (
    !/\b(received?|got|given|had)\b/i.test(q) &&
    /\bnext due\b|\bwhen is\b.*\bdue\b|\bnext (vaccines?|shots?|boosters?)\b/i.test(q)
  )
    aggregate = "next-due";

  const keywords = [
    ...new Set(
      q
        .replace(/[^a-z0-9µ/.\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d{4}/.test(t)),
    ),
  ];

  return { types, petMention, keywords, from, to, aggregate };
}
```

**Step 4: Run, verify pass, commit**

```bash
npm test
```
Expected: `ℹ pass 12` (11 intent + 1 smoke), `fail 0`.

```bash
git add src/lib/intent.ts tests/intent.test.ts
git commit -m "feat(chat): rule-based question intent parser (types/pet/keywords/window/aggregate)"
```

---

## Task 3: `src/lib/evidence.ts` — score, rank, format (pure)

Moves `flattenDetails`/line-formatting out of `chat-core.ts` (so it is unit-testable and reusable by the route), and adds scoring + a hard cap on what reaches the prompt. The cap is the fix for the contamination failures documented in `evals/cases.mts`.

**Files:**
- Create: `src/lib/evidence.ts`
- Modify: `src/lib/chat-core.ts` (delete `flattenDetails`/`humanizeKey`/inline line builder; re-export `flattenDetails` for compatibility)
- Test: `tests/evidence.test.ts`

**Step 1: Write the failing tests**

`tests/evidence.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenDetails, recordLine, buildEvidencePack, type EvidenceRecord } from "@/lib/evidence";
import type { Intent } from "@/lib/intent";

const rec = (over: Partial<EvidenceRecord>): EvidenceRecord => ({
  id: "r", petId: "p", petName: "Luna", type: "visit", title: "Exam",
  authoredAt: "2026-03-14", veterinarian: null, notes: null, details: null, ...over,
});

const open: Intent = { types: [], petMention: null, keywords: [], from: null, to: null, aggregate: null };

test("flattenDetails flattens nested values (moved from chat-core)", () => {
  assert.equal(
    flattenDetails(JSON.stringify({ values: { WBC: "7.1 K/µL" } })),
    "Values WBC: 7.1 K/µL",
  );
});

test("recordLine keeps the chat-core format, prefixed with the pet name", () => {
  const line = recordLine(
    rec({ type: "vaccination", title: "Rabies (1-year booster)", details: JSON.stringify({ nextDue: "2027-03-14" }) }),
  );
  assert.equal(line, "- Luna: Vaccination on 2026-03-14: Rabies (1-year booster). Details: Next Due: 2027-03-14");
});

test("recordLine truncates to maxChars with ellipsis", () => {
  const line = recordLine(rec({ notes: "x".repeat(500) }), 60);
  assert.ok(line.length <= 60 && line.endsWith("…"));
});

test("scoring prefers type match and keyword overlap", () => {
  const intent: Intent = { ...open, types: ["vaccination"], keywords: ["rabies"] };
  const pack = buildEvidencePack(
    [rec({ title: "Annual wellness exam", type: "visit", authoredAt: "2026-03-14" }),
     rec({ title: "Rabies (1-year booster)", type: "vaccination", authoredAt: "2026-03-14" })],
    intent,
  );
  assert.match(pack.lines[0], /Rabies/);
  // anything scoring 0 is dropped once some record scored (anySignal branch)
  assert.equal(pack.picked.length, 1);
  assert.equal(pack.dropped, 1);
});

test("records with zero score are dropped when anything scored", () => {
  const intent: Intent = { ...open, keywords: ["rabies"] };
  const pack = buildEvidencePack(
    [rec({ title: "Rabies booster" }), rec({ title: "Nail trim", type: "visit" })],
    intent,
  );
  assert.equal(pack.picked.length, 1);
  assert.equal(pack.dropped, 1);
});

test("all-zero scores fall back to most recent records, capped", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    rec({ id: `r${i}`, title: `T${i}`, authoredAt: `2026-01-${String(i + 1).padStart(2, "0")}` }),
  );
  const pack = buildEvidencePack(many, open);
  assert.equal(pack.picked.length, 8); // default maxRecords
  assert.match(pack.lines[0], /T11/); // most recent first
});
```

**Step 2: Run, verify failure** — `npm test` → cannot find `@/lib/evidence`.

**Step 3: Implement**

`src/lib/evidence.ts` — `humanizeKey` + `flattenDetails` move **verbatim** from `chat-core.ts:11-47`, then:

```ts
/**
 * Evidence selection: turns candidate records + an intent into the small,
 * relevant set of lines the 0.5B model actually sees. Replaces "dump every
 * record into the system prompt", which the eval suite showed contaminating
 * answers (stale dates leaking from unrelated records). Pure — unit-tested.
 */
import { RECORD_TYPE_LABELS, type RecordType } from "@/db/schema";
import type { Intent } from "@/lib/intent";

export interface EvidenceRecord {
  id: string;
  petId: string;
  petName: string;
  type: string;
  title: string;
  authoredAt: string;
  veterinarian: string | null;
  notes: string | null;
  details: string | null;
}

// … humanizeKey + flattenDetails moved here from chat-core.ts, unchanged …

/** Prompt line. Pet name always included: scope can span pets. */
export function recordLine(r: EvidenceRecord, maxChars = 400): string {
  const label = RECORD_TYPE_LABELS[r.type as RecordType] ?? r.type;
  let line = `- ${r.petName}: ${label} on ${r.authoredAt}: ${r.title}`;
  if (r.veterinarian) line += ` (vet: ${r.veterinarian})`;
  if (r.notes) line += `. Notes: ${r.notes}`;
  const details = flattenDetails(r.details);
  if (details) line += `. Details: ${details}`;
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

export function scoreRecord(intent: Intent, r: EvidenceRecord): number {
  let score = 0;
  if (intent.types.length && intent.types.includes(r.type as RecordType)) score += 3;
  const hay =
    `${r.petName} ${r.title} ${r.notes ?? ""} ${r.veterinarian ?? ""} ${flattenDetails(r.details)}`.toLowerCase();
  for (const k of intent.keywords) if (hay.includes(k)) score += 2;
  return score;
}

/**
 * Ranked, capped evidence. Keeps scored>0 records when any exist, otherwise
 * the most recent ones; ties break to newer. `dropped` is surfaced to the
 * model so it can say "records beyond what I can see" instead of guessing.
 */
export function buildEvidencePack(
  records: EvidenceRecord[],
  intent: Intent,
  opts: { maxRecords?: number; maxLineChars?: number } = {},
): { lines: string[]; picked: EvidenceRecord[]; dropped: number } {
  const maxRecords = opts.maxRecords ?? 8;
  const scored = records
    .map((r) => ({ r, s: scoreRecord(intent, r) }))
    .sort((a, b) => b.s - a.s || b.r.authoredAt.localeCompare(a.r.authoredAt));
  const anySignal = scored.some((x) => x.s > 0);
  const kept = (anySignal ? scored.filter((x) => x.s > 0) : scored).slice(0, maxRecords);
  const picked = kept.map((x) => x.r);
  return {
    lines: picked.map((r) => recordLine(r, opts.maxLineChars ?? 400)),
    picked,
    dropped: records.length - picked.length,
  };
}
```

**Step 4: Update `chat-core.ts` to stop duplicating** — delete its `humanizeKey`/`flattenDetails` (lines ~11-47) and add near the imports:

```ts
import { flattenDetails } from "@/lib/evidence";
```

A local **import** (not a re-export): the old `buildSystemPrompt` still calls `flattenDetails` internally at `chat-core.ts:83` until Task 6 replaces it, and nothing outside `chat-core` imports these helpers today (grep-verified — tests import from `@/lib/evidence` directly), so no re-export is needed.

**Step 5: Verify** — `npm test` (all green), `npm run evals:typecheck`, `npx tsc --noEmit` (app build typecheck) — no output = clean.

**Step 6: Commit**

```bash
git add src/lib/evidence.ts tests/evidence.test.ts src/lib/chat-core.ts
git commit -m "refactor(chat): extract evidence scoring/formatting from chat-core (pure, capped, tested)"
```

---

## Task 4: Query layer — SQL-side date filters + counting

`listRecords` currently only filters `petId`/`types`/`query`, and `limit` is a JS `.slice` after a full scan (`queries.ts:304-345`). Add what retrieval needs; keep the drizzle builders so both dialects keep working.

**Files:**
- Modify: `src/db/queries.ts:304-345` (extend `listRecords`), add `countRecords`
- Test: `tests/queries.test.ts` (integration against a temp SQLite copy — the pattern `evals/run.mts:25-46` already proved)

**Step 1: Write the failing test**

`tests/queries.test.ts`:

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Must be set BEFORE the first getDb() import resolves (connection is cached).
let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "novellia-test-"));
  process.env.SQLITE_PATH = path.join(dir, "novellia.db");
});

test("listRecords filters by petIds, types and date window", async () => {
  const { ensureSeed, listPets, listRecords } = await import("@/db/queries");
  await ensureSeed();
  const luna = (await listPets()).find((p) => p.name === "Luna")!;
  const all = await listRecords({ petIds: [luna.id] });
  assert.equal(all.length, 6); // seeded Luna record count
  const in2025 = await listRecords({ petIds: [luna.id], from: "2025-01-01", to: "2025-12-31" });
  assert.equal(in2025.length, 2); // DHPP booster 2025-03-02 + Apoquel 2025-11-08
  const vaxOnly = await listRecords({ petIds: [luna.id], types: ["vaccination"] });
  assert.equal(vaxOnly.length, 2);
  const capped = await listRecords({ petIds: [luna.id], limit: 3 });
  assert.equal(capped.length, 3);
  assert.ok(capped.every((r) => r.authoredAt >= "2025-11-08")); // newest first
});

test("countRecords aggregates by pet", async () => {
  const { ensureSeed, listPets, countRecords } = await import("@/db/queries");
  await ensureSeed();
  const pets = await listPets();
  const luna = pets.find((p) => p.name === "Luna")!;
  const all = await countRecords({ petIds: pets.map((p) => p.id), types: ["vaccination"] });
  assert.equal(all.count, 4); // Luna 2 + Miso 1 + Biscuit 1
  const perPet = await countRecords({ petIds: [luna.id], types: ["vaccination"] });
  assert.equal(perPet.count, 2);
  assert.equal(perPet.lastAt, "2026-03-14");
});
```

**Step 2: Run, verify failure** — `npm test` → `listRecords({ petIds … })` type errors / `countRecords` missing. (If tsc passes because `opts` isn't typed strictly, the assertion failures are the red state — either is fine.)

**Step 3: Implement**

Extend the `listRecords` options object (keep `petId` working for existing callers — `chat/route.ts:57`, `records/route.ts`, pages):

```ts
export async function listRecords(opts: {
  petId?: string;
  petIds?: string[];
  types?: RecordType[];
  query?: string;
  from?: string; // inclusive authored_at lower bound (ISO date)
  to?: string; // inclusive authored_at upper bound (ISO date)
  limit?: number;
}): Promise<RecordWithPet[]> {
```

Inside, extend the `conds` array (imports: add `gte, lte` to the drizzle import on line 3):

```ts
  if (opts.petIds?.length) conds.push(inArray(tables.medicalRecords.petId, opts.petIds));
  if (opts.from) conds.push(gte(tables.medicalRecords.authoredAt, opts.from));
  if (opts.to) conds.push(lte(tables.medicalRecords.authoredAt, opts.to));
```

Apply SQL limit: where the code currently builds `base`, add `.limit(opts.limit)` to both branches when `opts.limit` is set, and delete the post-hoc `.slice` (keep the function returning `rows` mapped as before).

Add next to `getDashboardStats`:

```ts
/** Exact counts straight from SQL — never let the 0.5B model count. */
export async function countRecords(opts: {
  petIds: string[];
  types?: RecordType[];
  from?: string;
  to?: string;
}): Promise<{ count: number; lastAt: string | null }> {
  const { db, tables } = await q();
  const conds = [inArray(tables.medicalRecords.petId, opts.petIds)];
  if (opts.types?.length) conds.push(inArray(tables.medicalRecords.type, opts.types));
  if (opts.from) conds.push(gte(tables.medicalRecords.authoredAt, opts.from));
  if (opts.to) conds.push(lte(tables.medicalRecords.authoredAt, opts.to));
  const rows = (await db
    .select({
      count: sql<number>`count(*)`,
      lastAt: sql<string | null>`max(${tables.medicalRecords.authoredAt})`,
    })
    .from(tables.medicalRecords)
    .where(and(...conds))) as unknown as Array<{ count: number; lastAt: string | null }>;
  return { count: Number(rows[0]?.count ?? 0), lastAt: rows[0]?.lastAt ?? null };
}
```

**Step 4: Verify** — `npm test` green (also reruns Task 2/3 suites: `ℹ pass 20`), `npx tsc --noEmit` clean, and the old callers still compile (`npx tsc --noEmit`).

**Step 5: Commit**

```bash
git add src/db/queries.ts tests/queries.test.ts
git commit -m "feat(db): SQL date-window filters, petIds, limit in listRecords; countRecords aggregate"
```

---

## Task 5: `src/lib/retrieval.ts` — scope resolution + deterministic answers

The orchestrator. **No model import anywhere in this file** — everything here is unit/integration testable in milliseconds, and the fast-path answers are exact.

**Files:**
- Create: `src/lib/retrieval.ts`
- Test: `tests/retrieval.test.ts`

**Step 1: Write the failing tests**

`tests/retrieval.test.ts` (same temp-DB pattern as Task 4):

```ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "novellia-retr-"));
  process.env.SQLITE_PATH = path.join(dir, "novellia.db");
});
const TODAY = new Date("2026-10-25T12:00:00Z");

test("question naming another pet overrides the selected pet", async () => {
  const { ensureSeed } = await import("@/db/queries");
  await ensureSeed();
  const { retrieve } = await import("@/lib/retrieval");
  const { listPets } = await import("@/db/queries");
  const luna = (await listPets()).find((p) => p.name === "Luna")!;
  const got = await retrieve("What is Biscuit's weight?", luna.id, TODAY);
  assert.deepEqual(got.scope.map((p) => p.name), ["Biscuit"]);
});

test("no petId scopes to all pets", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const got = await retrieve("How many vaccinations do I have?", undefined, TODAY);
  assert.equal(got.scope.length, 3);
});

test("count aggregate answers from SQL without the model", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const { listPets } = await import("@/db/queries");
  const luna = (await listPets()).find((p) => p.name === "Luna")!;
  const got = await retrieve("How many vaccinations does Luna have?", luna.id, TODAY);
  assert.match(got.fastAnswer!, /Luna has 2 vaccination records/);
});

test("count across all pets totals", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const got = await retrieve("How many vaccinations do I have across all pets?", undefined, TODAY);
  assert.match(got.fastAnswer!, /\b4\b/);
});

test("next-due picks the soonest future due date", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const { listPets } = await import("@/db/queries");
  const biscuit = (await listPets()).find((p) => p.name === "Biscuit")!;
  const got = await retrieve("When is Biscuit's next vaccine due?", biscuit.id, TODAY);
  assert.match(got.fastAnswer!, /2027-05-11/);
});

test("evidence pack excludes off-topic records", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const { listPets } = await import("@/db/queries");
  const biscuit = (await listPets()).find((p) => p.name === "Biscuit")!;
  const got = await retrieve("When did Biscuit get the RHDV2 vaccine?", biscuit.id, TODAY);
  assert.equal(got.fastAnswer, null); // date-given question → model path
  assert.equal(got.lines.length, 1);
  assert.match(got.lines[0], /RHDV2/); // the 2026 visit line not needed, kept out
});
```

**Step 2: Run, verify failure** — `npm test` → cannot find `@/lib/retrieval`.

**Step 3: Implement**

`src/lib/retrieval.ts`:

```ts
/**
 * Retrieval for Nova: question → scope + evidence (or an exact fast-path
 * answer that skips the model entirely). Deliberately model-free: the fast
 * path is exact SQL, and everything here is covered by tests/retrieval.test.ts.
 */
import "server-only";
import { listPets, listRecords, countRecords, type PetRow } from "@/db/queries";
import { parseIntent, type Intent } from "@/lib/intent";
import { buildEvidencePack, type EvidenceRecord } from "@/lib/evidence";

export interface Retrieved {
  scope: PetRow[];
  intent: Intent;
  lines: string[]; // system-prompt evidence
  dropped: number; // records excluded by the cap (surfaced in the prompt)
  fastAnswer: string | null; // exact answer; model is skipped when non-null
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function windowLabel(intent: Intent): string | null {
  if (intent.from && intent.to && intent.from.slice(0, 4) === intent.to.slice(0, 4))
    return ` in ${intent.from.slice(0, 4)}`;
  if (intent.from && intent.to) return ` between ${intent.from} and ${intent.to}`;
  if (intent.from) return ` since ${intent.from}`;
  return null;
}

/** Pet named in the question beats the selected pet; "all"/missing → every pet. */
export function resolveScope(petId: string | undefined, intent: Intent, pets: PetRow[]): PetRow[] {
  if (intent.petMention) {
    const hit = pets.find((p) => p.name.toLowerCase() === intent.petMention!.toLowerCase());
    if (hit) return [hit];
  }
  if (!petId || petId === "all") return pets;
  const sel = pets.find((p) => p.id === petId);
  return sel ? [sel] : [];
}

export async function retrieve(
  question: string,
  petId: string | undefined,
  today: Date = new Date(),
): Promise<Retrieved> {
  const pets = await listPets();
  const intent = parseIntent(question, pets.map((p) => p.name), today);
  const scope = resolveScope(petId, intent, pets);
  const ids = scope.map((p) => p.id);
  const types = intent.types.length ? intent.types : undefined;
  const from = intent.from ?? undefined;
  const to = intent.to ?? undefined;

  const empty: Retrieved = { scope, intent, lines: [], dropped: 0, fastAnswer: null };
  if (ids.length === 0) return empty; // never inArray([]) — invalid SQL

  const records = (await listRecords({ petIds: ids, types, from, to })) as unknown as EvidenceRecord[];
  const wl = windowLabel(intent);

  // Fast path 1: counting is SQL's job, not a 0.5B model's.
  if (intent.aggregate === "count") {
    const total = await countRecords({ petIds: ids, types, from, to });
    const label = intent.types.length === 1 ? `${intent.types[0]} records` : "records";
    empty.fastAnswer =
      scope.length === 1
        ? `${scope[0]?.name ?? "Your pet"} has ${total.count} ${label}${wl ?? ""}.`
        : `Across your pets there are ${total.count} ${label}${wl ?? ""}.`;
    return empty;
  }

  // Fast path 2: "next due" = min(details.nextDue >= today) over vaccinations.
  if (intent.aggregate === "next-due") {
    const candidates = records.filter((r) => r.type === "vaccination");
    const upcoming = candidates
      .map((r) => {
        try {
          const d = JSON.parse(r.details ?? "{}") as { nextDue?: string };
          return d.nextDue && d.nextDue >= isoDay(today) ? { r, due: d.nextDue } : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is { r: EvidenceRecord; due: string } => x !== null)
      .sort((a, b) => a.due.localeCompare(b.due));
    empty.fastAnswer = upcoming.length
      ? `${upcoming[0].r.petName}'s "${upcoming[0].r.title}" is next due ${upcoming[0].due}.` +
        (upcoming.length > 1 ? ` (${upcoming.length} vaccinations are upcoming in total.)` : "")
      : "No upcoming vaccinations are in the records. Please ask the veterinarian.";
    return empty;
  }

  const pack = buildEvidencePack(records, intent);
  return { ...empty, lines: pack.lines, dropped: pack.dropped };
}
```

**Step 4: Verify** — `npm test` green (`ℹ pass 26`), `npx tsc --noEmit` clean.

**Step 5: Commit**

```bash
git add src/lib/retrieval.ts tests/retrieval.test.ts
git commit -m "feat(chat): retrieval orchestrator — scope resolution, evidence pack, SQL fast paths"
```

---

## Task 6: `chat-core.ts` — evidence-based multi-pet prompt

Replace "all records" prompt construction with the evidence pack. Keep the guardrail, refusal text, and the golden-question behavior intact (all 15 existing eval cases must stay green).

> **Next 16 note:** this file is imported by both the route and the eval harness; no route conventions here, but re-read `evals/README.md` "How it works" before changing `answerQuestion`'s contract.

**Files:**
- Modify: `src/lib/chat-core.ts`
- Test: existing `npm run evals` is the test (model behavior gate); no new unit test here.

**Step 1: Rewrite `buildSystemPrompt`** (signature change — callers updated in this task):

```ts
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
    `Example question: Write me a JavaScript function.`,
    `Example answer: I can only answer questions about ${firstName}'s records. Try asking about ${firstName}'s visits, vaccines, lab results, or medications.`,
    "",
    ...petBlocks,
    "",
    "EVIDENCE (most relevant first):",
    lines.length ? lines.join("\n") : "(no matching records)",
    dropped > 0 ? `(${dropped} older/lower-ranked records are not shown.)` : "",
  ].filter((s) => s !== undefined && s !== "").join("\n");
}
```

(Example answers/refusal wording stay byte-identical where graded: keep `refusalText` untouched.)

**Step 2: Rework `answerQuestion`** to route through retrieval:

```ts
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
```

**Fix imports in `chat-core.ts`.** The new `buildSystemPrompt(scope: PetRow[], …)` needs `PetRow`, and `answerQuestion` now uses `retrieve` + `listPets`. Replace the top imports:

```ts
import { listPets, type PetRow } from "@/db/queries";
import { streamChat, type ChatMessagePart } from "@/lib/model";
import { retrieve } from "@/lib/retrieval";
```

The old `buildSystemPrompt` used `listRecords` and `RECORD_TYPE_LABELS` (and `RecordType`) directly — with the prompt now built from pre-scored `lines`, those become unused; and the reworked `answerQuestion` resolves pet names via `listPets` (needed now that `petId` may be `"all"`/undefined). So `getPet`, `listRecords`, `RECORD_TYPE_LABELS` and `RecordType` are all dropped from `chat-core.ts` imports (the `RECORD_TYPE_LABELS` re-export moved to `evidence.ts` in Task 3). `npm run lint` only *warns* on unused imports today, so a stale one won't fail the gate — remove them anyway for a clean tree.

**Step 3: Verify compile + evals** — `npx tsc --noEmit`; the route still references the old prompt builder until Task 7 — if tsc flags `route.ts`, do Task 7 before running `npm run evals`.

**Step 4: Commit**

```bash
git add src/lib/chat-core.ts
git commit -m "feat(chat): evidence-based multi-pet system prompt; retrieval in answerQuestion"
```

---

## Task 7: Wire the route and the chat panel

**Read first (repo rule):** `node_modules/next/dist/docs/01-app/03-api-reference/05-file-conventions/route.md` before editing the route.

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/components/chat-panel.tsx`

**Step 1: Route — optional/`"all"` petId, retrieval, fast path.** Replace the pet-resolution block (`route.ts:13-21`) with:

```ts
  const petId = body.petId; // undefined or "all" = every pet
  const scoped = petId && petId !== "all" ? await getPet(petId) : null;
  if (petId && petId !== "all" && !scoped) {
    return Response.json({ error: "pet not found" }, { status: 404 });
  }
  const threadId = scoped?.id ?? "all"; // chat history thread id ("all" = global thread)
```

Use `threadId` in every `saveChatMessage`/`listChatMessages` call. For the refusal (guard) path, use `scoped?.name ?? "your pet"`. Replace the `history`/`records` fetch + prompt build (`route.ts:55-68`) with retrieval:

```ts
  const [history, got] = await Promise.all([
    listChatMessages(threadId, 12),
    retrieve(userText || "", petId),
  ]);
  if (got.fastAnswer) {
    await saveChatMessage(threadId, "assistant", got.fastAnswer);
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
    return createUIMessageStreamResponse({ stream: fast });
  }
  const modelMessages: ChatMessagePart[] = [
    { role: "system", content: buildSystemPrompt(got.scope, got.lines, got.dropped) },
    ...history.filter((h) => h.role === "user" || h.role === "assistant")
      .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
  ];
```

(Keep the existing "ensure the just-saved user turn is represented" guard, the streaming block, and error handling unchanged.)

**Step 2: ChatPanel — add the "All pets" option.** In `src/components/chat-panel.tsx` select (`SelectContent` near line 79), before the pets map:

```tsx
<SelectItem value="all">All pets</SelectItem>
```

and adjust the description (`line 69`): when `petId === "all"`, render `grounded in all your pets’ records` instead of the per-pet string. `transport` body already sends whatever `petId` state holds — `"all"` flows straight through. Default selection stays `pets[0]?.id` (lower-risk than flipping to "all").

**Step 3: Verify by hand** (dev server; model downloads on first ask):

```bash
npm run dev
curl -s localhost:3000/api/chat -H 'content-type: application/json' -d \
 '{"petId":"all","messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"How many vaccinations do I have across all pets?"}]}]}' | tr '\n' ' ' | grep -o 'Across your pets[^"]*'
```
Expected: `Across your pets there are 4 vaccination records.` — streams in milliseconds, **model not loaded at all** (no `data-modelStatus` line for this reply).

**Step 4: Regression evals + commit**

```bash
npm run evals
git add src/app/api/chat/route.ts src/components/chat-panel.tsx
git commit -m "feat(chat): optional petId ('all' scope), mention override, SQL fast path through /api/chat"
```

---

## Task 8: Evals — lock in the new behavior

**Files:**
- Modify: `evals/cases.mts` (5 new cases + `scope` field)
- Modify: `evals/run.mts:196-205` (pass `petId: undefined` for `scope: "all"`) and `:274` (server mode: send `"all"`)
- Modify: `evals/README.md` (one line documenting `scope`)

**Step 1: Extend the case type** in `cases.mts`:

```ts
export interface EvalCase {
  // … existing fields …
  /** "all" = ask against every pet (in-process: petId undefined; server: "all"). */
  scope?: "all";
}
```

**Step 2: Add the golden cases** (deterministic fast-path cases get `attempts: 1` — that is the point):

```ts
  {
    id: "agg-count-luna",
    pet: "Luna",
    isolated: true,
    question: "How many vaccinations does Luna have?",
    assertions: [{ kind: "mustMatch", pattern: /\b2\b/, why: "Luna has exactly 2 vaccination records" }],
  },
  {
    id: "agg-count-all",
    pet: "Luna",
    scope: "all",
    isolated: true,
    question: "How many vaccinations do I have across all pets?",
    assertions: [{ kind: "mustMatch", pattern: /\b4\b/, why: "Luna 2 + Miso 1 + Biscuit 1" }],
  },
  {
    id: "agg-next-due",
    pet: "Biscuit",
    isolated: true,
    question: "When is Biscuit's next vaccine due?",
    assertions: [{ kind: "dateOnly", iso: "2027-05-11", why: "soonest future nextDue" }],
  },
  {
    id: "mention-override",
    pet: "Luna", // selector says Luna — the question must still scope to Biscuit
    isolated: true,
    attempts: 2,
    question: "What is Biscuit's weight?",
    assertions: [
      { kind: "mustMatch", pattern: /1\.6\s*kg|1600\s*g/i, why: "Biscuit weighs 1.6 kg" },
      { kind: "mustNotMatch", pattern: /17\.4/, why: "must not answer Luna's weight" },
    ],
  },
  {
    id: "retrieval-narrow",
    pet: "Luna",
    isolated: true,
    attempts: 2,
    question: "What was Luna's WBC value? Quote the number.",
    assertions: [
      { kind: "mustMatch", pattern: /7\.1/, why: "evidence pack must keep the CBC line" },
      { kind: "mustNotMatch", pattern: /normal range|within normal/i, why: "no invented commentary" },
    ],
  },
```

(`retrieval-narrow` duplicates `luna-lab-values` on purpose: it is the *same* golden question whose pass rate should improve — watch its `attempts` usage drop. Remove the older duplicate only after both have been green in CI a while.)

**Step 3: Run.mts support** — in-process call (`run.mts:197`):

```ts
        const res = await answerQuestion({
          petId: c.scope === "all" ? undefined : petId.get(c.pet)!,
          question: c.question,
          history: historyFor(c, runs, isolatedIds),
        });
```

Server-mode body (`run.mts:274`): `body: JSON.stringify({ petId: c.scope === "all" ? "all" : petId.get(c.pet), messages })`.

**Step 4: Run**

```bash
npm run evals:typecheck
npm run evals -- --filter agg   # 3/3; each case's `ms` is ~0 (fast path skips inference —
                                # but note in-process mode still warms the model once per
                                # harness run, run.mts:166-177; use EVAL_BASE_URL to time
                                # against an already-warm server)
npm run evals                   # full suite: existing 15 + new 5 all pass
```
Expected: `20/20 passed`. If an existing case regresses, suspect prompt wording first (`chat-core.ts`) — same debugging note the README already gives. **Exception:** if `biscuit-rhdv2` fails on a wrong year (2027…), the intent regex regressed (see Task 2's past-tense regression test), not the prompt.

> **Temporal cliff (document, don't fix now):** the golden next-due dates are future dates (Luna 2027-03-14, Biscuit 2027-05-11). `answerQuestion` calls `retrieve()` with the *real* clock, so `agg-next-due` — and `rabies-next-due`, which now also takes the fast path — flip to "No upcoming vaccinations…" once those dates pass. The unit tests (Tasks 2/5) inject `TODAY` and stay stable. When the dates go stale: re-date the seed records, or add a fixed `EVAL_TODAY` env through `answerQuestion → retrieve`. (Behavior the eval suite always had: its date assertions were already seed-anchored.)

Two behavior notes for the review of this task:

- `unknown-info-honesty` ("blood pressure … last visit") now hits **filtered** evidence (the lab + visit synonyms pre-scope `listRecords`) instead of all of Biscuit's records. No record line mentions blood pressure either way, so the must-not-invent assertion holds — but the path changed.
- The fast-path cases prove `attempts: 1` determinism, which was impossible pre-plan (sampling noise).

**Step 5: Commit**

```bash
git add evals/cases.mts evals/run.mts evals/README.md
git commit -m "test(evals): cross-pet aggregates, next-due, mention override, retrieval narrowing"
```

---

## Task 9: Docs + final verification

**Files:**
- Modify: `README.md` ("Ask Nova" bullet + Layout tree)
- Modify: `.spec/DESIGN.md` (stack section + a short "Q&A retrieval" decision note)

**Step 1: README** — extend the Ask Nova bullet: answers are grounded in a **retrieved subset** of records (intent → SQL filter → scored evidence), count/date answers come straight from SQLite without loading the model, and "All pets" scope + pet-name mentions route the question.

**Step 2: DESIGN.md** — record the decision: *retrieval over prompt-stuffing; deterministic SQL fast paths for aggregates; text-to-SQL and tool-calling rejected (0.5B reliability, injection); embeddings deferred until >~200 records/pet or evals show keyword misses.* Mention the known simplification: `"all"`-scoped chats persist under the literal `pet_id = 'all'` thread (per-pet history stays clean; revisit with real auth/multi-thread work).

**Step 3: Full gate**

```bash
npm test && npm run lint && npm run evals:typecheck && npm run evals && npm run build
```
All green. Final commit:

```bash
git add README.md .spec/DESIGN.md .spec/plans/2026-10-25-pet-qa-retrieval.md
git commit -m "docs: retrieval-grounded Nova decisions; plan: pet Q&A over SQLite"
```

---

## Out of scope (explicit)

- Embeddings / sqlite-vec semantic search (revisit trigger documented above).
- Multi-pet **comparison** in one question (e.g. "compare Luna and Miso's weights"): `resolveScope` matches a single pet mention (longest name) or falls back to the selected/all scope — it does not resolve two pets into a two-row evidence table. Users get one pet's answer, not a side-by-side. Fine for the demo; a real comparison feature is separate work.
- Model upgrade (larger local or hosted model) — separate decision, README privacy stance.
- Auth / multi-owner scoping (already planned in `.spec/DESIGN.md`; retrieval inherits it later via `owner_id` filters in `listPets`).
- Real chat threading for "all" scope (uses the `pet_id = 'all'` simplification for now).
