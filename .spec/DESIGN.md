# Novellia Pets — Design Decisions

## Stack
- **Next.js 16 (App Router, TypeScript, `cacheComponents`)** — frontend + API in one deployable.
- **shadcn/ui** (dashboard-01 block as shell foundation) + Tailwind v4.
- **AI SDK v7 + @huggingface/transformers.js** — `Qwen/Qwen2.5-0.5B-Instruct` (quantized q4f16; q8_0 on the Pi) runs **server-side** in a route handler, streaming to the client with `useChat`.
  - Chosen server-side: models in `node_modules` never ship to the browser, ~1GB download belongs on the server, and it matches the HF Next.js AI SDK tutorial.
  - Chat is grounded in the pet's real records (documents, labs, prescriptions) injected into the system prompt — this is the "one interesting feature": an on-device, private AI assistant over the pet's medical history.
- **Persistence:** Drizzle ORM.
  - Dev: better-sqlite3 file DB (`./data/novellia.db`) — survives refresh.
  - Deployed (`DATABASE_URL` set): Postgres (libsql/postgres driver). Single SQL dialect kept ANSI-compatible; schema is the source of truth, migrated with drizzle-kit push/migrate.
- **Deployment:** Dockerfile (multi-stage, standalone Next output, run with `node server.js`) + `k8/novellia-pets.yml` mirroring the `spacialsimplicity` k3s conventions (default namespace, Deployment + ClusterIP + NodePort 30080 Services on the Pi (registry at 192.168.0.25:5000, public via Cloudflare Tunnel → `:30080`), `/api/health` probes, sqlite on a PVC by default; `DATABASE_URL` via secretRef only for the opt-in Postgres variant).

## Data model
- `owners` — single seeded default owner (auth intentionally deferred; see below).
- `pets` — name, species, breed, sex, date of birth, weight_kg, photo color/emoji, owner_id.
- `medical_records` — pet_id, type (visit | vaccination | lab | prescription | document), title, authored_at, veterinarian, notes, plus optional type-specific JSON `details` (e.g. vaccine lot, lab test values, prescription dosage). Not editable in the record dialog (removed as unfriendly); still stored, displayed, and used as chat evidence.
  - One table + discriminator instead of per-type tables: records share 90% of fields, the sidebar sections (Documents / Labs / Prescriptions / Visits) are filtered views over the same table, and it keeps filtering/search simple.
- `chat_threads` / `chat_messages` — persisted chat history per pet.

## Auth (not implemented, plan)
Single-tenant demo with a seeded owner. For production: NextAuth/Clerk with owner_id scoping on every query; row-level security as defense in depth; medical data ⇒ encrypt at rest, audit log on record access.

## Q&A retrieval (2026-10)
- **Retrieval over prompt-stuffing.** Every question used to embed ALL of a
  pet's records in the system prompt; the eval suite documented answer
  contamination (stale dates leaking from unrelated records). Now: rule-based
  intent parse (`src/lib/intent.ts`) → SQL pre-filter → scored, capped evidence
  pack, max 8 lines (`src/lib/evidence.ts`, orchestrated by
  `src/lib/retrieval.ts`).
- **Deterministic SQL fast paths for "how many" / "next due"** — exact answers,
  no inference. The greedy-decoding switch made `rabies-next-due`
  deterministically wrong via the model; answering it in SQL makes it exact.
- **Rejected:** text-to-SQL (a 0.5B can't write safe SQL; injection surface);
  LLM tool-calling (unreliable JSON at this size); embeddings/sqlite-vec
  (extra native deps + a second ONNX model on a memory-tight RPi for tiny
  data). Revisit at >~200 records/pet, or when keyword retrieval starts
  missing synonyms users actually type.
- **Known simplification:** "all"-scoped chats persist under the literal
  `pet_id = 'all'` thread (per-pet history stays clean). Revisit with real
  auth/multi-thread work.
- **Known temporal caveat:** golden next-due eval dates (2027) go stale; see
  `evals/README.md`.

## Not fully satisfied with
Running transformers.js inside the Next server: cold start is slow (model load ~10–60s) and memory-hungry per pod. With more time: pre-download the model into the image (or a PVC), run a warm dedicated inference sidecar/worker with health-gated rollout, or fall back to a hosted small model.

## Run

```
npm install && npm run dev        # sqlite auto-created + seeded at ./data/novellia.db
docker compose up --build         # http://localhost:3000
```

Deployment: `k8/novellia-pets.yml` (Deployment + PVC + ClusterIP + NodePort 30080,
matching spacialsimplicity k3s conventions otherwise; `DATABASE_URL` from `novellia-db-secret` only when the Postgres variant is deployed).
