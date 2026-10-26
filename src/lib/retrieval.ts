/**
 * Retrieval for Nova: question → scope + evidence (or an exact fast-path
 * answer that skips the model entirely). Deliberately model-free: the fast
 * path is exact SQL, and everything here is covered by tests/retrieval.test.ts.
 */
import "server-only";
import { listPets, listRecords, countRecords, type PetRow } from "@/db/queries";
import { RECORD_TYPE_LABELS } from "@/db/schema";
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

function ageText(dob: string, today: Date): string {
  const b = new Date(`${dob}T00:00:00Z`);
  let months = (today.getUTCFullYear() - b.getUTCFullYear()) * 12 + today.getUTCMonth() - b.getUTCMonth();
  if (today.getUTCDate() < b.getUTCDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const part = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  if (y === 0) return part(m, "month");
  return m ? `${part(y, "year")}, ${part(m, "month")}` : part(y, "year");
}

/** Exact answer for one pet from its profile + (already scoped) records; "" if unknown. */
export function lookupAnswer(
  lookup: NonNullable<Intent["lookup"]>,
  pet: PetRow,
  records: EvidenceRecord[],
  today: Date,
): string {
  const mine = records.filter((r) => r.petId === pet.id); // records arrive newest-first
  switch (lookup) {
    case "age":
      return pet.dateOfBirth
        ? `${pet.name} was born ${pet.dateOfBirth} and is ${ageText(pet.dateOfBirth, today)} old.`
        : "";
    case "weight":
      return pet.weightG ? `${pet.name} weighs ${(pet.weightG / 1000).toFixed(1)} kg.` : "";
    case "vet": {
      const latest = mine.find((r) => r.veterinarian);
      if (!latest) return "";
      const all = [...new Set(mine.map((r) => r.veterinarian).filter(Boolean))];
      return `${pet.name}'s most recent veterinarian is ${latest.veterinarian} (${latest.title}, ${latest.authoredAt}).` +
        (all.length > 1 ? ` Other vets in the records: ${all.filter((v) => v !== latest.veterinarian).join(", ")}.` : "");
    }
    case "meds": {
      const rx = mine.filter((r) => r.type === "prescription");
      if (!rx.length) return `${pet.name} has no prescriptions in the records.`;
      return `${pet.name}'s prescriptions: ` + rx.map((r) => `${r.title} (${r.authoredAt})`).join("; ") + ".";
    }
  }
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
    // Noun choice keeps verbatim answers grammatical: "1 lab result", "2 lab results",
    // "1 vaccination", "2 prescriptions", "3 records".
    let noun = "record";
    if (intent.types.length === 1) {
      noun =
        intent.types[0] === "lab"
          ? "lab result"
          : RECORD_TYPE_LABELS[intent.types[0]].toLowerCase();
    }
    const label = `${noun}${total.count === 1 ? "" : "s"}`;
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

  if (intent.lookup) {
    const answers = scope.map((pet) => lookupAnswer(intent.lookup!, pet, records, today)).filter(Boolean);
    if (answers.length) {
      empty.fastAnswer = answers.join(" ");
      return empty;
    }
  }

  const pack = buildEvidencePack(records, intent);
  return { ...empty, lines: pack.lines, dropped: pack.dropped };
}
