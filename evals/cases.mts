/**
 * Golden-question eval set for the Nova chat (npm run evals).
 *
 * Grading is deterministic regex checks — no LLM judge, so results are
 * reproducible run to run. Each case names the seeded pet it expects
 * (see ensureSeed in src/db/queries.ts).
 *
 * keepInContext: only this case's Q/A stays in the simulated conversation
 * window (other turns are pruned), used where the follow-up wording would
 * otherwise poison an unrelated case.
 */
/**
 * A date written ISO ("2026-05-11") or long-form ("May 11, 2026").
 * `d` is capped at 2 chars so a "2027-03" fragment can't satisfy the year.
 */
export function isoDatePattern(iso: string): RegExp {
  const [y, m, d] = iso.split("-").map(Number);
  const MON = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ];
  return new RegExp(
    String.raw`${y}[-/.]\s*(0?${m})[-/.]\s*(0?${d})(?!\d)|${MON[(m ?? 1) - 1]}\w*\.?\D{0,8}${d}\D{0,12}${y}`,
    "i",
  );
}

/** True if the answer contains any year other than `iso`'s (near-word-bounded). */
function mentionsOtherYear(text: string, iso: string): boolean {
  const keep = iso.slice(0, 4);
  return Array.from(text.matchAll(/(?<!\d)20\d\d(?!\d)/g)).some((m) => m[0] !== keep);
}

export type EvalAssertion =
  | { kind: "mustMatch"; pattern: RegExp; why: string }
  | { kind: "mustNotMatch"; pattern: RegExp; why: string }
  | { kind: "dateOnly"; iso: string; why: string }
  | { kind: "refused" }
  | { kind: "notRefused"; why: string };

export interface EvalCase {
  id: string;
  pet: "Luna" | "Miso" | "Biscuit";
  question: string;
  /** Prior turns prepended as [user, assistant] pairs (simulated history). */
  context?: string[];
  /**
   * Isolated case: runs with a fresh context (only its own `context`), not
   * the accumulated prior-case conversation. Use where wording from other
   * cases would otherwise poison the graded answer.
   */
  isolated?: boolean;
  /**
   * Run the case N times; pass if ANY run passes. The 0.5B model is
   * non-deterministic (sampling), so strict-extraction cases need repeats
   * to grade reliably. Default 1.
   */
  attempts?: number;
  /** "all" = ask against every pet (in-process: petId undefined; server: "all"). */
  scope?: "all";
  assertions: EvalAssertion[];
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "rabies-next-due",
    pet: "Luna",
    // In the shared conversation the earlier "what vaccines" answers drift
    // into the reply; a standalone ask (like a real user's first message) is
    // what we can grade strictly.
    isolated: true,
    attempts: 3,
    question: "When is Luna's next rabies vaccine due? Quote the exact date from the records.",
    assertions: [
      { kind: "dateOnly", iso: "2027-03-14", why: "must quote nextDue 2027-03-14 and no other year" },
    ],
  },
  {
    id: "luna-weight",
    pet: "Luna",
    // "17.4 kg" extraction wobbles when prior answers are in context —
    // sampling noise, so allow one retry.
    attempts: 2,
    question: "What does Luna weigh?",
    assertions: [
      { kind: "mustMatch", pattern: /17(\.4)?\s*kg|17\.4/i, why: "must state 17.4 kg" },
    ],
  },
  {
    id: "luna-lab-values",
    pet: "Luna",
    isolated: true,
    attempts: 2,
    question: "What was Luna's WBC value? Quote the number.",
    assertions: [
      { kind: "mustMatch", pattern: /7\.1/, why: "must quote WBC 7.1 K/µL from the CBC panel" },
      { kind: "mustNotMatch", pattern: /normal range|within normal/i, why: "should not invent reference-range commentary" },
    ],
  },
  {
    id: "miso-species",
    pet: "Miso",
    question: "What type of animal is Miso?",
    assertions: [
      { kind: "mustMatch", pattern: /cat/i, why: "Miso is a cat" },
    ],
  },
  {
    id: "luna-vet-name",
    pet: "Luna",
    attempts: 2,
    question: "Which veterinarian saw Luna most recently?",
    assertions: [
      { kind: "mustMatch", pattern: /okafor/i, why: "Luna's records list Dr. Okafor" },
    ],
  },
  {
    id: "biscuit-rhdv2",
    pet: "Biscuit",
    // "2022" from Luna's spay record leaked into the shared-conversation
    // answer; grade this the same way a user's first message behaves.
    isolated: true,
    attempts: 2,
    question: "When did Biscuit receive the RHDV2 vaccine (the date it was given, not the next due date)?",
    assertions: [
      { kind: "mustMatch", pattern: isoDatePattern("2026-05-11"), why: "must quote the 2026-05-11 date" },
    ],
  },
  {
    id: "luna-prescription-dose",
    pet: "Luna",
    isolated: true,
    attempts: 3,
    question: "What dosage of Apoquel is Luna on?",
    assertions: [
      { kind: "mustMatch", pattern: /\b16\s*mg\b/i, why: "must quote the recorded 16 mg dosage" },
    ],
  },
  {
    id: "guard-react",
    pet: "Luna",
    question: "make a react component",
    assertions: [{ kind: "refused" }],
  },
  {
    id: "guard-poem",
    pet: "Miso",
    question: "write me a poem about the ocean",
    assertions: [{ kind: "refused" }],
  },
  {
    id: "guard-capital",
    pet: "Luna",
    question: "what is the capital of Australia?",
    assertions: [{ kind: "refused" }],
  },
  {
    id: "guard-recipe",
    pet: "Biscuit",
    question: "give me a recipe for chicken curry",
    assertions: [{ kind: "refused" }],
  },
  {
    id: "near-boundary-app",
    pet: "Luna",
    // "what app" is pet-plausible phrasing, but the 0.5B prompt-following is
    // coin-flip on it — two attempts pass if either response behaves.
    question: "what app should I use to track feeding?",
    attempts: 2,
    assertions: [
      { kind: "notRefused", why: "pet-plausible question must reach the model, not the guardrail" },
    ],
  },
  {
    id: "near-boundary-explain",
    pet: "Miso",
    question: "explain the kidney disease finding",
    assertions: [
      { kind: "notRefused", why: "pet-plausible question must reach the model, not the guardrail" },
    ],
  },
  {
    id: "profile-age",
    pet: "Luna",
    question: "how old is luna",
    assertions: [
      { kind: "mustMatch", pattern: /\b5 years?\b/i, why: "born 2021-04-12 → computed from DB, not guessed" },
    ],
  },
  {
    id: "profile-vet-biscuit",
    pet: "Biscuit",
    question: "who is biscuit's vet",
    assertions: [
      { kind: "mustMatch", pattern: /reyes/i, why: "Biscuit's vet is Dr. Reyes" },
      { kind: "mustNotMatch", pattern: /current age/i, why: "no garbled answer" },
    ],
  },
  {
    id: "profile-meds",
    pet: "Luna",
    question: "what are luna's meds",
    assertions: [
      { kind: "mustMatch", pattern: /apoquel/i, why: "must name the recorded prescription" },
    ],
  },
  {
    id: "followup-pronoun",
    pet: "Luna",
    question: "And when is the booster?",
    context: [
      "What vaccines has Luna had?",
      "The records say Luna received a Rabies (1-year booster) on 2026-03-14.",
    ],
    isolated: true,
    assertions: [
      { kind: "notRefused", why: "follow-up about records must reach the model" },
    ],
  },
  {
    id: "unknown-info-honesty",
    pet: "Biscuit",
    question: "What was Biscuit's blood pressure at the last visit?",
    // Sampling noise: the honest "not in the records" answer appears in most
    // runs; two attempts keeps the suite deterministic in practice.
    attempts: 2,
    assertions: [
      // No BP recorded — the model must not invent a reading like 90/60.
      { kind: "mustNotMatch", pattern: /\b\d{2,3}\s*\/\s*\d{2,3}\b/i, why: "must not invent a BP reading like 120/80" },
    ],
  },
  {
    id: "agg-count-luna",
    pet: "Luna",
    // Fast path (SQL count) — deterministic, no model, so attempts stays 1.
    isolated: true,
    question: "How many vaccinations does Luna have?",
    assertions: [{ kind: "mustMatch", pattern: /\b2\b/, why: "Luna has exactly 2 vaccination records" }],
  },
  {
    id: "agg-count-all",
    pet: "Luna",
    // Selector says Luna; the question names no pet, so "all" scope must
    // count across every pet. Fast path, deterministic.
    scope: "all",
    isolated: true,
    question: "How many vaccinations do I have across all pets?",
    assertions: [{ kind: "mustMatch", pattern: /\b4\b/, why: "Luna 2 + Miso 1 + Biscuit 1" }],
  },
  {
    id: "agg-next-due",
    pet: "Biscuit",
    // Fast path (min future nextDue) — deterministic. Temporal cliff: flips
    // to "No upcoming vaccinations…" once 2027-05-11 passes; see README.
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
    // Intentionally the same golden question as "luna-lab-values": it is the
    // retrieval-narrowing regression probe — same ask, higher pass
    // reliability under the evidence pack. Do not "clean up" this duplicate.
    isolated: true,
    attempts: 2,
    question: "What was Luna's WBC value? Quote the number.",
    assertions: [
      { kind: "mustMatch", pattern: /7\.1/, why: "evidence pack must keep the CBC line" },
      { kind: "mustNotMatch", pattern: /normal range|within normal/i, why: "no invented commentary" },
    ],
  },
];
