import { sql } from "drizzle-orm";
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import {
  index as sqliteIndex,
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";

export const RECORD_TYPES = [
  "visit",
  "vaccination",
  "lab",
  "prescription",
  "document",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  visit: "Visit",
  vaccination: "Vaccination",
  lab: "Lab result",
  prescription: "Prescription",
  document: "Document",
};

/**
 * Schema for both dialects (identical logical shape).
 *
 * Design choices:
 * - ids are string UUIDs (not serial ints) so rows are created identically on
 *   sqlite and postgres from application code.
 * - timestamps are ISO-8601 strings and `details` is a JSON string in both
 *   dialects, keeping the SQL layer ANSI-compatible (drizzle `text`).
 * - `weightG` is an integer number of grams to avoid decimal handling
 *   differences between dialects.
 *
 * Tables are declared twice (once per dialect) rather than via a shared
 * factory: the two drizzle `sqliteTable`/`pgTable` functions have union
 * signatures TypeScript can't call through a boolean switch.
 */

const ownersSqlite = sqliteTable("owners", {
  id: sqliteText("id").primaryKey(),
  name: sqliteText("name").notNull(),
  email: sqliteText("email"),
  createdAt: sqliteText("created_at").notNull().default(sql`(current_timestamp)`),
});
const petsSqlite = sqliteTable("pets", {
  id: sqliteText("id").primaryKey(),
  ownerId: sqliteText("owner_id").notNull(),
  name: sqliteText("name").notNull(),
  species: sqliteText("species").notNull(),
  breed: sqliteText("breed"),
  sex: sqliteText("sex"),
  dateOfBirth: sqliteText("date_of_birth"),
  weightG: sqliteInteger("weight_g"),
  notes: sqliteText("notes"),
  emoji: sqliteText("emoji"),
  createdAt: sqliteText("created_at").notNull().default(sql`(current_timestamp)`),
});
const medicalRecordsSqlite = sqliteTable(
  "medical_records",
  {
    id: sqliteText("id").primaryKey(),
    petId: sqliteText("pet_id").notNull(),
    type: sqliteText("type").notNull(),
    title: sqliteText("title").notNull(),
    authoredAt: sqliteText("authored_at").notNull(),
    veterinarian: sqliteText("veterinarian"),
    notes: sqliteText("notes"),
    details: sqliteText("details"),
    createdAt: sqliteText("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [sqliteIndex("medical_records_pet_idx").on(t.petId, t.type)],
);
const chatMessagesSqlite = sqliteTable(
  "chat_messages",
  {
    id: sqliteText("id").primaryKey(),
    petId: sqliteText("pet_id").notNull(),
    role: sqliteText("role").notNull(),
    content: sqliteText("content").notNull(),
    createdAt: sqliteText("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [sqliteIndex("chat_messages_pet_idx").on(t.petId)],
);

const ownersPg = pgTable("owners", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});
const petsPg = pgTable("pets", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  species: text("species").notNull(),
  breed: text("breed"),
  sex: text("sex"),
  dateOfBirth: text("date_of_birth"),
  weightG: integer("weight_g"),
  notes: text("notes"),
  emoji: text("emoji"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});
const medicalRecordsPg = pgTable(
  "medical_records",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    authoredAt: text("authored_at").notNull(),
    veterinarian: text("veterinarian"),
    notes: text("notes"),
    details: text("details"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("medical_records_pet_idx").on(t.petId, t.type)],
);
const chatMessagesPg = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("chat_messages_pet_idx").on(t.petId)],
);

export const sqliteTables = {
  owners: ownersSqlite,
  pets: petsSqlite,
  medicalRecords: medicalRecordsSqlite,
  chatMessages: chatMessagesSqlite,
};

export const pgTables = {
  owners: ownersPg,
  pets: petsPg,
  medicalRecords: medicalRecordsPg,
  chatMessages: chatMessagesPg,
};
