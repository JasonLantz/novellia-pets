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
  assert.match(got.fastAnswer!, /Luna has 2 vaccinations/);
});

test("count answers are grammatical for singular counts", async () => {
  const { retrieve } = await import("@/lib/retrieval");
  const { listPets } = await import("@/db/queries");
  const luna = (await listPets()).find((p) => p.name === "Luna")!;
  const got = await retrieve("How many lab results does Luna have?", luna.id, TODAY);
  assert.match(got.fastAnswer!, /Luna has 1 lab result\./);
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
  assert.match(got.lines[0], /RHDV2/); // only the vaccination line is relevant
});
