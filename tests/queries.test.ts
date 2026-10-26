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
