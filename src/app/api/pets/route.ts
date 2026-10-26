import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";


type Body = {
  name?: string;
  species?: string;
  breed?: string | null;
  sex?: string | null;
  dateOfBirth?: string | null;
  weightKg?: number | null;
  notes?: string | null;
  emoji?: string | null;
};

function toRow(b: Body) {
  return {
    name: (b.name ?? "").trim(),
    species: (b.species ?? "").trim(),
    breed: b.breed?.trim() || null,
    sex: b.sex || null,
    dateOfBirth: b.dateOfBirth || null,
    weightG:
      b.weightKg != null && !Number.isNaN(Number(b.weightKg))
        ? Math.round(Number(b.weightKg) * 1000)
        : null,
    notes: b.notes?.trim() || null,
    emoji: b.emoji?.trim() || null,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const row = toRow(body);
  if (!row.name || !row.species) {
    return NextResponse.json({ error: "name and species are required" }, { status: 400 });
  }
  const { db, tables } = await getDb();
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  const values = {
    ...row,
    id,
    ownerId: "owner-demo",
    createdAt: new Date().toISOString(),
  };
// db from getDb() is `any` at the boundary (see src/db/client.ts)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(tables.pets).values(values);
  return NextResponse.json(values, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Body & { id?: string };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db, tables } = await getDb();
  const patch: Record<string, unknown> = toRow(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).update(tables.pets).set(patch).where(eq(tables.pets.id, body.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any)
    .select()
    .from(tables.pets)
    .where(eq(tables.pets.id, body.id))
    .limit(1);
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const { id } = await request.json() as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db, tables } = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  await d.delete(tables.medicalRecords).where(eq(tables.medicalRecords.petId, id));
  await d.delete(tables.chatMessages).where(eq(tables.chatMessages.petId, id));
  await d.delete(tables.pets).where(eq(tables.pets.id, id));
  return NextResponse.json({ ok: true });
}
