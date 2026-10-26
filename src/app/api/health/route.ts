import { NextResponse } from "next/server";

// Liveness/readiness target for the k8s probes (k8/novellia-pets.yml).
// Deliberately does not touch the DB or the model: "the server process
// answers HTTP" is exactly what the probes should assert, and on a
// memory-strained node (the Pi) a DB-flaked probe would restart the pod
// for no recovery benefit. (No route segment config: this Next version
// rejects `dynamic` when cacheComponents is on, and a cached {ok:true}
// responds just as well to probes.)
export function GET() {
  return NextResponse.json({ ok: true });
}
