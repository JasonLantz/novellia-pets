/**
 * Question understanding for Nova: maps a question to a bounded retrieval
 * intent. Pure — no DB, no model, no "server-only" (unit-tested directly).
 * All parsing is rule-based on purpose: a 0.5B model cannot be trusted to
 * plan queries, and every rule here is exercised in tests/intent.test.ts.
 */
import type { RecordType } from "@/db/schema";

export type Aggregate = "count" | "next-due" | null;

/** Profile/record facts answered exactly from the DB (a 0.5B model garbles them). */
export type Lookup = "vet" | "age" | "weight" | "meds" | null;

export interface Intent {
  types: RecordType[]; // [] = any type
  petMention: string | null; // exact stored pet name, if the question names one
  keywords: string[]; // content tokens for evidence scoring
  from: string | null; // inclusive lower bound on authoredAt (ISO date)
  to: string | null; // inclusive upper bound on authoredAt (ISO date)
  aggregate: Aggregate;
  lookup: Lookup;
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
  "what", "when", "where", "which", "how", "many", "much", "of", "to",
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

/** Past-tense receipt wording asks for the ADMINISTERED date, not a due date. */
export function isPastReceipt(q: string): boolean {
  return /\b(received?|got|given|had)\b/i.test(q);
}

/** Questions whose answer is the earliest future details.nextDue. */
export function isNextDueQuestion(q: string): boolean {
  return (
    /\bnext due\b|next [^?.!]{0,30}\bdue\b|due [^?.!]{0,20}\bnext\b|\bwhen (is|are|will)\b.{0,40}\bdue\b|\bnext (vaccines?|shots?|boosters?)\b|\bdue soon\b|\boverdue\b/i.test(
      q,
    )
  );
}

export function parseIntent(
  question: string,
  petNames: string[],
  today: Date = new Date(),
): Intent {
  const q = question.toLowerCase();

  // Apostrophe-free copy for the next-due trigger only: a contraction like
  // "what's the next vaccine due?" otherwise breaks word-boundary matching
  // (the s in "what's" is a word char). Types/window/keywords still read from
  // `q`, which keeps eval "biscuit-rhdv2" suppressed: its "next due date)"
  // matches the trigger on BOTH copies, but isPastReceipt gates it out.
  const qApos = q.replace(/['’]/g, "");

  const types = TYPE_SYNONYMS.filter(([, re]) => re.test(q)).map(([t]) => t);

  // Pet mention: longest name first so "Big Luna" can't be stolen by "Luna";
  // word-bounded so "Mi" never matches inside "Miso". (Matches against the
  // original question: stored pet names contain no apostrophes.)
  let petMention: string | null = null;
  for (const name of [...petNames].filter((n) => n.length > 0).sort((a, b) => b.length - a.length)) {
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
    const n = months ? Number(months[1]) : NaN;
    if (months && n >= 1 && n <= 60) {
      // reject nonsense spans (garbled/typo questions) rather than open the
      // window back to 1943; wider spans belong to explicit years
      const d = new Date(today);
      d.setUTCMonth(d.getUTCMonth() - n); // UTC math: isoDay reads UTC fields
      from = isoDay(d);
    }
  }

  let aggregate: Aggregate = null;
  if (/\bhow many\b/.test(q)) aggregate = "count";
  // Known suppression: a compound question ("when did X receive it, and when
  // is the next due?") loses the fast path and falls through to the model.
  // Load-bearing for evals/cases.mts "biscuit-rhdv2" (asks for the GIVEN date
  // while its text literally contains "next due").
  else if (!isPastReceipt(q) && (isNextDueQuestion(q) || isNextDueQuestion(qApos))) aggregate = "next-due";

  // Direct fact lookups. Dosage/refill wording is left to the model (it needs
  // the specific record's details), as are date-window questions.
  let lookup: Lookup = null;
  if (!aggregate) {
    if (/\bhow old\b|\b(age|birthday|birthdate|born)\b/.test(q)) lookup = "age";
    else if (/\bweigh\w*\b/.test(q)) lookup = "weight";
    else if (/\b(vets?|veterinarians?|doctors?)\b/.test(q) && !/\bvisit\w*\b/.test(q)) lookup = "vet";
    else if (
      /\b(meds?|medications?|prescriptions?|prescribed)\b/.test(q) &&
      /\b(what|which|list|any)\b/.test(q) &&
      !/\b(dos\w*|refills?|mg|frequency|often|when|how)\b/.test(q) &&
      !from
    )
      lookup = "meds";
  }

  const keywords = [
    ...new Set(
      q
        .replace(/['’]s\b/g, "")
        .replace(/[^a-z0-9µ/.\s-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d{4}/.test(t)),
    ),
  ];

  return { types, petMention, keywords, from, to, aggregate, lookup };
}
