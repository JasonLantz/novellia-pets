/**
 * Evidence selection: turns candidate records + an intent into the small,
 * relevant set of lines the 0.5B model actually sees. Replaces "dump every
 * record into the system prompt" (see chat-core's buildSystemPrompt), which
 * the eval suite showed contaminating answers (stale dates leaking from
 * unrelated records). Pure — unit-tested.
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

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Details JSON is free-form; the model reads flat "key value" pairs best, so
 * flatten before prompting — never leak raw braces to the LLM.
 */
export function flattenDetails(raw: string | null): string {
  if (!raw) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.trim();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return String(raw).trim();
  const parts: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (iv === null || iv === undefined) continue;
        parts.push(`${humanizeKey(k)} ${ik}: ${iv}`);
      }
    } else if (Array.isArray(v)) {
      parts.push(`${humanizeKey(k)}: ${v.join(", ")}`);
    } else {
      parts.push(`${humanizeKey(k)}: ${v}`);
    }
  }
  return parts.join("; ");
}

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
