import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { RECORD_TYPES, type RecordType } from "@/db/schema";


type Body = {
  id?: string;
  petId?: string;
  type?: RecordType;
  title?: string;
  authoredAt?: string;
  veterinarian?: string | null;
  notes?: string | null;
  details?: Record<string, unknown> | null;
};

function toRow(b: Body) {
  return {
    type: b.type ?? "document",
    title: (b.title ?? "").trim(),
    authoredAt: b.authoredAt || new Date().toISOString().slice(0, 10),
    veterinarian: b.veterinarian?.trim() || null,
    notes: b.notes?.trim() || null,
    details:
      b.details && Object.keys(b.details).length ? JSON.stringify(b.details) : null,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!body.petId) return NextResponse.json({ error: "petId required" }, { status: 400 });
  const row = toRow(body);
  if (!row.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!RECORD_TYPES.includes(row.type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  const { db, tables } = await getDb();
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  const values = { ...row, id, petId: body.petId, createdAt: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(tables.medicalRecords).values(values);
  return NextResponse.json(values, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as Body;
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch = toRow(body);
  const { db, tables } = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(tables.medicalRecords)
    .set(patch)
    .where(eq(tables.medicalRecords.id, body.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any)
    .select()
    .from(tables.medicalRecords)
    .where(eq(tables.medicalRecords.id, body.id))
    .limit(1);
  if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(request: Request) {
  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db, tables } = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).delete(tables.medicalRecords).where(eq(tables.medicalRecords.id, id));
  return NextResponse.json({ ok: true });
}
