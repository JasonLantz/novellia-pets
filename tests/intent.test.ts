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

test("last N months clamps nonsense spans", () => {
  assert.equal(parseIntent("visits in the last 999 months", PETS, TODAY).from, null);
  assert.equal(parseIntent("visits in the last 13 months", PETS, TODAY).from, "2025-09-25");
});

test("explicit year wins over relative wording", () => {
  const i = parseIntent("checkups this year 2025", PETS, TODAY);
  assert.equal(i.from, "2025-01-01");
  assert.equal(i.to, "2025-12-31");
});

test("pet names with regex metacharacters still match literally", () => {
  assert.equal(parseIntent("how is C+ doing?", ["C+"], TODAY).petMention, "C+");
  assert.equal(parseIntent("how is C doing?", ["C."], TODAY).petMention, null);
});

test("broader next-due phrasings are caught", () => {
  assert.equal(parseIntent("when are the vaccines due?", PETS, TODAY).aggregate, "next-due");
  assert.equal(parseIntent("which boosters are overdue?", PETS, TODAY).aggregate, "next-due");
  assert.equal(parseIntent("is anything due soon?", PETS, TODAY).aggregate, "next-due");
});

test("next-x-due phrasing without 'when' is caught", () => {
  assert.equal(parseIntent("What is the next vaccine due date?", PETS, TODAY).aggregate, "next-due");
  assert.equal(parseIntent("what's the next shot due?", PETS, TODAY).aggregate, "next-due");
});

test("mixed past-tense question suppresses the fast path", () => {
  // documented tradeoff: compound asks fall through to the model
  assert.equal(
    parseIntent("when did Luna receive it and when is the next due?", PETS, TODAY).aggregate,
    null,
  );
});

test("profile lookups route to exact answers", () => {
  const l = (q: string) => parseIntent(q, PETS, TODAY).lookup;
  assert.equal(l("who is luna's vet"), "vet");
  assert.equal(l("how old is luna"), "age");
  assert.equal(l("what are luna's meds"), "meds");
  assert.equal(l("What does Luna weigh?"), "weight");
  assert.equal(l("What dosage of Apoquel is Luna on?"), null);
  assert.equal(l("when was luna's last vet visit"), null);
});
