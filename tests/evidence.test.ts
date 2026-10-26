import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenDetails, recordLine, buildEvidencePack, type EvidenceRecord } from "@/lib/evidence";
import type { Intent } from "@/lib/intent";

const rec = (over: Partial<EvidenceRecord>): EvidenceRecord => ({
  id: "r", petId: "p", petName: "Luna", type: "visit", title: "Exam",
  authoredAt: "2026-03-14", veterinarian: null, notes: null, details: null, ...over,
});

const open: Intent = { types: [], petMention: null, keywords: [], from: null, to: null, aggregate: null, lookup: null };

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
