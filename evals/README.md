# Nova chat evals

Grades the chat answering pipeline (guardrail → record-grounded system prompt →
Qwen2.5-0.5B) against golden questions with deterministic assertions.

```bash
npm run evals                      # in-process: boots its own model + temp DB copy
npm run evals -- --filter guard    # only cases whose id contains "guard" (comma-separated list ok)
npm run evals -- --json            # machine-readable summary on stdout (nothing else)
npm run evals:typecheck            # typecheck the harness itself

EVAL_BASE_URL=http://localhost:3000 npm run evals   # against a running server's /api/chat
```

## How it works

- `cases.mts` — the golden set. Each case: pet, question, optional `context`
  (prior turns), optional `isolated` (fresh conversation), optional `attempts`
  (N runs, pass if any pass — the 0.5B model samples, so strict-extraction
  cases need repeats), optional `scope: "all"` (asks that span every pet: the
  in-process call passes `petId: undefined`, server mode sends `"all"` — the
  case's `pet` still names the *selected* pet), and regex assertions:
  `mustMatch`, `mustNotMatch`, `dateOnly` (exact ISO/long-form date, no other
  year), `refused`, `notRefused`.
- `run.mts` — runs cases in order inside one simulated conversation (stale
  earlier answers sit in the context window, like real use), grades, and exits
  1 on any failure (CI-gateable).

## Modes

- **In-process** (default): imports the production pipeline
  (`src/lib/chat-core.ts`) directly; uses a throwaway copy of `data/novellia.db`
  under `$TMPDIR`, so eval traffic never touches the dev app's chat history.
- **Server** (`EVAL_BASE_URL=…`): posts to a live `/api/chat` — tests the
  deployed stack including history persistence; needs a writable DB and will
  grow its `chat_messages` table.

## Notes

- Cases rely on the seeded demo pets (Luna/Miso/Biscuit) — `ensureSeed()` runs
  first, so a fresh checkout works out of the box.
- The 0.5B model is genuinely non-deterministic; expect the occasional
  borderline miss on `near-boundary-*` cases. When a case fails consistently
  (not sporadically), the regression is real — check the prompt in
  `src/lib/chat-core.ts` first.
- Fast-path cases (`agg-*`, `rabies-next-due`) answer from SQL without
  inference, so they grade deterministically (`attempts: 1`) and take ~0.0s
  each. In-process mode still warms the model once per run before timing, so
  total wall time is dominated by the model cases; set `EVAL_BASE_URL` to time
  against an already-warm server.
- **Temporal cliff:** the golden next-due dates are future dates (Luna
  2027-03-14, Biscuit 2027-05-11). `answerQuestion` calls `retrieve()` with
  the real clock, so `agg-next-due` — and `rabies-next-due`, which now takes
  the fast path — flip to "No upcoming vaccinations…" once those dates pass.
  The unit tests (tests/intent.test.ts, tests/retrieval.test.ts) inject
  `TODAY` and stay stable. When the dates go stale: re-date the seed records
  in `src/db/queries.ts`, or thread a fixed `EVAL_TODAY` env through
  `answerQuestion → retrieve`. (The suite always had this property: its date
  assertions were seed-anchored from the start.)
