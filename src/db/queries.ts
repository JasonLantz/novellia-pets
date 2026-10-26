import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import {
  getDb,
  initSchema,
} from "./client";
import { RECORD_TYPES, RECORD_TYPE_LABELS, type RecordType } from "./schema";

export { RECORD_TYPE_LABELS };

/* ---------- row/mapping types (dialect-agnostic) ---------- */

export interface PetRow {
  id: string;
  ownerId: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  weightG: number | null;
  notes: string | null;
  emoji: string | null;
  createdAt: string;
}

export interface RecordRow {
  id: string;
  petId: string;
  type: string;
  title: string;
  authoredAt: string;
  veterinarian: string | null;
  notes: string | null;
  details: string | null;
  createdAt: string;
}

export interface ChatRow {
  id: string;
  petId: string;
  role: string;
  content: string;
  createdAt: string;
}

export type PetInput = Omit<PetRow, "id" | "ownerId" | "createdAt">;
export type RecordInput = Omit<
  RecordRow,
  "id" | "petId" | "createdAt" | "details"
> & { details?: Record<string, unknown> | null };

const DEFAULT_OWNER_ID = "owner-demo";

async function q() {
  const loaded = await getDb();
  await initSchema(loaded);
  return loaded;
}

export async function ensureSeed() {
  const { db, tables } = await q();
  const existing = await db.select().from(tables.owners).limit(1);
  if (existing.length > 0) return;
  await db.insert(tables.owners).values({
    id: DEFAULT_OWNER_ID,
    name: "Alex Rivera",
    email: "alex@example.com",
    createdAt: new Date().toISOString(),
  });
  await seedDemoPets(db, tables);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedDemoPets(db: any, tables: any) {
  const now = new Date().toISOString();
  type SeedRecord = {
    type: string;
    title: string;
    authoredAt: string;
    veterinarian?: string;
    notes?: string;
    details?: Record<string, unknown>;
  };
  const pets: Array<{ pet: PetInput; records: SeedRecord[] }> = [
    {
      pet: {
        name: "Luna",
        species: "Dog",
        breed: "Border Collie",
        sex: "female",
        dateOfBirth: "2021-04-12",
        weightG: 17400,
        emoji: "🐕",
        notes: "Reacts to thunderstorms; microchip 985141002233445.",
      },
      records: [
        {
          type: "visit",
          title: "Annual wellness exam",
          authoredAt: "2026-03-14",
          veterinarian: "Dr. Okafor",
          notes: "Healthy. Teeth mild tartar; recommend dental cleaning next year.",
        },
        {
          type: "vaccination",
          title: "Rabies (1-year booster)",
          authoredAt: "2026-03-14",
          veterinarian: "Dr. Okafor",
          details: { lot: "RB-88213", nextDue: "2027-03-14" },
        },
        {
          type: "vaccination",
          title: "DHPP booster",
          authoredAt: "2025-03-02",
          veterinarian: "Dr. Okafor",
          details: { lot: "DH-55120", nextDue: "2026-03-02" },
        },
        {
          type: "lab",
          title: "CBC + chemistry panel",
          authoredAt: "2026-03-14",
          veterinarian: "Dr. Okafor",
          notes: "All within reference ranges.",
          details: { values: { WBC: "7.1 K/µL", ALT: "48 U/L", CRE: "0.9 mg/dL" } },
        },
        {
          type: "prescription",
          title: "Apoquel 16mg",
          authoredAt: "2025-11-08",
          veterinarian: "Dr. Okafor",
          notes: "For seasonal itch; 1 tablet daily for 14 days during flare.",
          details: { dosage: "16 mg", frequency: "once daily", refills: 1 },
        },
        {
          type: "document",
          title: "Spay surgery discharge summary",
          authoredAt: "2022-01-20",
          notes: "Uncomplicated procedure, recovered well.",
        },
      ],
    },
    {
      pet: {
        name: "Miso",
        species: "Cat",
        breed: "Domestic Shorthair",
        sex: "male",
        dateOfBirth: "2019-09-01",
        weightG: 5200,
        emoji: "🐈",
        notes: "Early-stage CKD monitored every 6 months. Prescription diet only.",
      },
      records: [
        {
          type: "lab",
          title: "SDMA + creatinine recheck",
          authoredAt: "2026-06-30",
          veterinarian: "Dr. Lindqvist",
          notes: "SDMA slightly elevated, stable vs last year. Continue IRIS stage 1 monitoring.",
          details: { values: { SDMA: "18 µg/dL", CRE: "2.1 mg/dL" } },
        },
        {
          type: "prescription",
          title: "Renal diet transition (Rx)",
          authoredAt: "2025-07-05",
          veterinarian: "Dr. Lindqvist",
          notes: "Transition over 2 weeks; recheck weight monthly.",
          details: { dosage: "as directed", frequency: "daily", refills: 3 },
        },
        {
          type: "visit",
          title: "Dental cleaning",
          authoredAt: "2025-07-05",
          veterinarian: "Dr. Lindqvist",
          notes: "Two extractions (upper premolars). Resorptive lesions.",
        },
        {
          type: "vaccination",
          title: "FVRCP booster",
          authoredAt: "2025-07-05",
          veterinarian: "Dr. Lindqvist",
          details: { lot: "FV-30122", nextDue: "2026-07-05" },
        },
      ],
    },
    {
      pet: {
        name: "Biscuit",
        species: "Rabbit",
        breed: "Holland Lop",
        sex: "male",
        dateOfBirth: "2023-02-18",
        weightG: 1600,
        emoji: "🐇",
        notes: "Grazing on hay; nails trimmed monthly.",
      },
      records: [
        {
          type: "visit",
          title: "Wellness + nail trim",
          authoredAt: "2026-05-11",
          veterinarian: "Dr. Reyes",
          notes: "Teeth normal on otoscopic exam. Weight stable.",
        },
        {
          type: "vaccination",
          title: "RHDV2 vaccine",
          authoredAt: "2026-05-11",
          veterinarian: "Dr. Reyes",
          details: { lot: "RH-12004", nextDue: "2027-05-11" },
        },
      ],
    },
  ];

  for (const { pet, records } of pets) {
    const petId = randomUUID();
    await db.insert(tables.pets).values({
      ...pet,
      id: petId,
      ownerId: DEFAULT_OWNER_ID,
      createdAt: now,
    });
    for (const r of records) {
      await db.insert(tables.medicalRecords).values({
        ...r,
        details: r.details ? JSON.stringify(r.details) : null,
        id: randomUUID(),
        petId,
        createdAt: now,
      });
    }
  }
}

/* ---------------------------- pets ---------------------------- */

export async function listPets(): Promise<
  Array<PetRow & { recordCount: number; lastRecordAt: string | null }>
> {
  const { db, tables } = await q();
  const rows = (await db
    .select({
      pet: tables.pets,
      recordCount: sql<number>`count(${tables.medicalRecords.id})`,
      lastRecordAt: sql<string | null>`max(${tables.medicalRecords.authoredAt})`,
    })
    .from(tables.pets)
    .leftJoin(
      tables.medicalRecords,
      eq(tables.pets.id, tables.medicalRecords.petId),
    )
    .groupBy(tables.pets.id)
    .orderBy(tables.pets.name)) as unknown as Array<{
    pet: PetRow
    recordCount: number
    lastRecordAt: string | null
  }>;
  return rows.map((r) => ({
    ...r.pet,
    recordCount: Number(r.recordCount),
    lastRecordAt: r.lastRecordAt,
  }));
}

export async function getPet(id: string): Promise<PetRow | null> {
  const { db, tables } = await q();
  const rows = await db.select().from(tables.pets).where(eq(tables.pets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPet(input: PetInput): Promise<PetRow> {
  const { db, tables } = await q();
  const row = { ...input, id: randomUUID(), ownerId: DEFAULT_OWNER_ID, createdAt: new Date().toISOString() };
  await db.insert(tables.pets).values(row);
  return row;
}

export async function updatePet(id: string, input: Partial<PetInput>): Promise<PetRow | null> {
  const { db, tables } = await q();
  const rows = await db.update(tables.pets).set(input).where(eq(tables.pets.id, id)).returning();
  if (rows.length) return rows[0];
  // sqlite in older better-sqlite3 or dialects without RETURNING: reselect
  return getPet(id);
}

export async function deletePet(id: string) {
  const { db, tables } = await q();
  await db.delete(tables.medicalRecords).where(eq(tables.medicalRecords.petId, id));
  await db.delete(tables.chatMessages).where(eq(tables.chatMessages.petId, id));
  await db.delete(tables.pets).where(eq(tables.pets.id, id));
}

/* ------------------------- medical records ------------------------- */

export interface RecordWithPet extends RecordRow {
  petName: string;
  petSpecies: string;
  petEmoji: string | null;
}

export async function listRecords(opts: {
  petId?: string;
  petIds?: string[];
  types?: RecordType[];
  query?: string;
  from?: string; // inclusive authored_at lower bound (ISO date)
  to?: string; // inclusive authored_at upper bound (ISO date)
  limit?: number;
}): Promise<RecordWithPet[]> {
  const { db, tables } = await q();
  const conds = [];
  if (opts.petId) conds.push(eq(tables.medicalRecords.petId, opts.petId));
  if (opts.petIds?.length) conds.push(inArray(tables.medicalRecords.petId, opts.petIds));
  if (opts.types?.length) conds.push(inArray(tables.medicalRecords.type, opts.types));
  if (opts.from) conds.push(gte(tables.medicalRecords.authoredAt, opts.from));
  if (opts.to) conds.push(lte(tables.medicalRecords.authoredAt, opts.to));
  if (opts.query) {
    const qbe = `%${opts.query}%`;
    conds.push(
      or(
        like(tables.medicalRecords.title, qbe),
        like(tables.medicalRecords.notes, qbe),
        like(tables.medicalRecords.veterinarian, qbe),
      ),
    );
  }
  const base = db
    .select({
      rec: tables.medicalRecords,
      petName: tables.pets.name,
      petSpecies: tables.pets.species,
      petEmoji: tables.pets.emoji,
    })
    .from(tables.medicalRecords)
    .innerJoin(tables.pets, eq(tables.medicalRecords.petId, tables.pets.id));
  const built = conds.length ? base.where(and(...conds)) : base;
  const rows = await (opts.limit
    ? built.orderBy(desc(tables.medicalRecords.authoredAt)).limit(opts.limit)
    : built.orderBy(desc(tables.medicalRecords.authoredAt)));
  return (
    rows as unknown as Array<{
      rec: RecordRow
      petName: string
      petSpecies: string
      petEmoji: string | null
    }>
  ).map((r) => ({ ...r.rec, petName: r.petName, petSpecies: r.petSpecies, petEmoji: r.petEmoji }));
}

export async function getRecord(id: string): Promise<RecordRow | null> {
  const { db, tables } = await q();
  const rows = await db.select().from(tables.medicalRecords).where(eq(tables.medicalRecords.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createRecord(petId: string, input: RecordInput): Promise<RecordRow> {
  const { db, tables } = await q();
  const row = {
    ...input,
    details: input.details ? JSON.stringify(input.details) : null,
    id: randomUUID(),
    petId,
    createdAt: new Date().toISOString(),
  };
  await db.insert(tables.medicalRecords).values(row);
  return row;
}

export async function updateRecord(
  id: string,
  input: Partial<RecordInput> & { details?: unknown },
): Promise<RecordRow | null> {
  const { db, tables } = await q();
  const set: Record<string, unknown> = { ...input };
  if ("details" in set) {
    set.details = input.details == null ? null : JSON.stringify(input.details);
  }
  const rows = await db.update(tables.medicalRecords).set(set).where(eq(tables.medicalRecords.id, id)).returning();
  if (rows.length) return rows[0];
  return getRecord(id);
}

export async function deleteRecord(id: string) {
  const { db, tables } = await q();
  await db.delete(tables.medicalRecords).where(eq(tables.medicalRecords.id, id));
}

/* ----------------------------- chat ----------------------------- */

export async function listChatMessages(petId: string, limit = 40): Promise<ChatRow[]> {
  const { db, tables } = await q();
  const rows = await db
    .select()
    .from(tables.chatMessages)
    .where(eq(tables.chatMessages.petId, petId))
    .orderBy(desc(tables.chatMessages.createdAt))
    .limit(limit);
  return (rows as ChatRow[]).reverse();
}

/** Persist a chat turn directly via SQL (dialect-compatible INSERT). */
export async function saveChatMessage(petId: string, role: "user" | "assistant", content: string) {
  const { db } = await q();
  await db.run(
    sql`insert into chat_messages (id, pet_id, role, content, created_at) values (${randomUUID()}, ${petId}, ${role}, ${content}, ${new Date().toISOString()})`,
  );
}

export async function clearChat(petId: string) {
  const { db, tables } = await q();
  await db.delete(tables.chatMessages).where(eq(tables.chatMessages.petId, petId));
}

/* --------------------------- dashboard --------------------------- */

export async function getDashboardStats() {
  const { db, tables } = await q();
  const petRows = (await db
    .select({ c: sql<number>`count(*)` })
    .from(tables.pets)) as unknown as Array<{ c: number }>;
  const recRows = (await db
    .select({ c: sql<number>`count(*)` })
    .from(tables.medicalRecords)) as unknown as Array<{ c: number }>;
  const byTypeRows = (await db
    .select({ type: tables.medicalRecords.type, c: sql<number>`count(*)` })
    .from(tables.medicalRecords)
    .groupBy(tables.medicalRecords.type)) as unknown as Array<{
    type: string
    c: number
  }>;
  const counts: Record<string, number> = Object.fromEntries(RECORD_TYPES.map((t) => [t, 0]));
  for (const r of byTypeRows) counts[r.type] = Number(r.c);
  return {
    pets: Number(petRows[0]?.c ?? 0),
    records: Number(recRows[0]?.c ?? 0),
    byType: counts,
  };
}

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

export { DEFAULT_OWNER_ID };
