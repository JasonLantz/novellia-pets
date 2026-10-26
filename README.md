# Novellia Pets

MVP for tracking and managing pets' medical records, with an on-device AI
assistant (“Nova”) grounded in each pet's records.

View the app live at **[https://www.novellia-pets.com](https://www.novellia-pets.com)** or run locally at http://localhost:3000.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000  — sqlite auto-creates ./data/novellia.db and seeds demo pets
```

or with Docker:

```bash
docker compose up --build   # http://localhost:3000 (container port 3300), data persisted in a volume
```

Qwen2.5-0.5B-Instruct (~480MB) is downloaded on first use (or at server boot
unless `WARM_MODEL=0`) and cached under `.models/`; later chats start in
seconds. The Docker image does **not** bake the weights in (`scripts/prefetch-model.mts`
exists to pre-download them, but the Dockerfile doesn't run it), so a fresh
container downloads them again.

## What's inside

- **Pets**: add / view / edit / delete (dashboard, pets grid, pet detail).
- **Medical records**: one record table with a type discriminator — Visits,
  Vaccinations, Labs, Prescriptions, Documents — each a filtered view in the
  sidebar, with per-pet views on the pet page. The add/edit dialog covers
  type, date, title, veterinarian and notes; the optional type-specific
  `details` JSON (still accepted by `/api/records`, shown as key/value pairs on
  records, and used as chat evidence) is no longer editable in the UI.
- **Dashboard**: per-pet overview (age, weight, record count, last activity),
  record counts by type, recent activity feed.
- **Search**: URL-driven `?q=` search over pets and records (title, notes, vet).
- **Ask Nova (the extra feature)**: chat with a local `Qwen2.5-0.5B-Instruct`
  (quantized ONNX via transformers.js, streamed through the Vercel AI SDK).
  Answers are grounded in a *retrieved* subset of records — rule-based intent
  parse → SQL filters → scored evidence pack (cap 8 lines; `src/lib/intent.ts`,
  `evidence.ts`, `retrieval.ts`) — not the pet's whole history. "How many" /
  "next due" questions are answered straight from SQLite, no model involved
  (deterministic, instant). The picker's **All pets** scope answers across
  pets, and a question naming a different pet answers about that pet. Chosen
  because medical records are the sensitive heart of the app — private,
  offline inference over them is both genuinely useful and respectful of that
  sensitivity.
- **Persistence**: Drizzle ORM. Dev = better-sqlite3 file (survives refresh).
  Deployed = set `DATABASE_URL=postgres://…` and the same code uses Postgres
  (`npm run db:push` to migrate). SQLite and Postgres schemas are kept
  ANSI-compatible by design (UUID text PKs, ISO strings, JSON-as-text).

## Deploy

Target: k3s on `ubuntu@192.168.0.25` (RPi4, arm64) — registry on the same box
(spacialsimplicity pattern). Live at **https://www.novellia-pets.com** via a
Cloudflare Tunnel to nodePort **30080** (plain NodePort service; hostPort-binding
LoadBalancers collide with the other stacks on the box). The tunnel's public
hostname route for `www.novellia-pets.com` must target
`http://192.168.0.25:30080` — pointing it at `:3300` (the container port,
not exposed on the host) returns a Cloudflare 502.

Deploy uses `npm run` scripts (see package.json):

```bash
npm run deploy        # docker:deploy + k3s:restart
npm run docker:deploy # image only (build + tag + push to 192.168.0.25:5000)
npm run k3s:restart   # kubectl rollout restart onto the new :latest
kubectl apply -f k8/novellia-pets.yml   # manifest changes (no npm script)
```

Build the image for arm64 (run on the Pi, or `--platform linux/arm64`). The
image is a Next `output: "standalone"` build started with `node server.js`
(it must not be started with `next start`, which doesn't work with standalone
output and breaks dynamic pages with `DYNAMIC_SERVER_USAGE` 500s).

Notes the Pi forced: the manifest sets `MODEL_DTYPE=q8_0` (Cortex-A72 has no
fp16 — q4f16 SIGILLs); image push can be slow/flaky on the SD card; sqlite on a
`local-path` PVC (`DATABASE_URL` unset — see src/db/client.ts); no boot-time
model warm (`WARM_MODEL=0`) so memory pressure on the shared node can't OOM
us, so the first chat pays the model load; probes hit `/api/health` with a 5s
timeout so a loaded node doesn't trigger false restarts.

## Test & evals

```bash
npm test             # unit + integration suite (tsx + node:test)
npm run evals        # golden-question evals against a fresh scenario DB (20 cases)
npm run evals:server # same eval suite via HTTP against a dev server on localhost:3000 (reuses the server's model and live DB)
```

## Layout

```
src/app/            routes: dashboard, pets, records, documents, labs, prescriptions, visits, ask, api/{pets,records,chat,health}
src/db/             schema (sqlite + pg), client (env-switched), queries
src/lib/model.ts    transformers.js pipeline (lazy singleton, streaming)
src/lib/intent.ts   rule-based question parser (types, pet mention, keywords, window, aggregate)
src/lib/evidence.ts candidate scoring + capped evidence-pack formatting (pure)
src/lib/retrieval.ts orchestrator: scope resolution, SQL pre-filter, count/next-due fast paths
src/lib/chat-core.ts  guardrail + prompt builders (single-pet, evidence-based multi-pet)
src/components/     shadcn dashboard-01 shell + dialogs, chat panel, tables
scripts/            prefetch-model (pre-downloads weights; not run by the Dockerfile)
k8/novellia-pets.yml   Deployment + PVC + ClusterIP + NodePort(30080) services
                       (default namespace, registry 192.168.0.25:5000, k3s on the Pi)
```

## Design decisions & tradeoffs

See [.spec/DESIGN.md](.spec/DESIGN.md) — including auth plans and the decision
I'm least happy with (in-process inference: ~10s cold start per pod; with more
time I'd run a warm inference sidecar or pre-warm via a startup probe).

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | unset → sqlite | Postgres connection when deployed |
| `SQLITE_PATH` | `./data/novellia.db` | sqlite database file |
| `TRANSFORMERS_CACHE_DIR` | `.models` | model weight cache |
| `MODEL_DTYPE` | `q4f16` | quantization of the ONNX export (`q8_0` on the Pi) |
| `WARM_MODEL` | unset → warm at boot | set `0` to skip boot-time model load |
| `PORT` / `HOSTNAME` | `3300` / — | standalone server bind (image sets `PORT=3300`; k8s sets `HOSTNAME=0.0.0.0`) |
