// Client for the FastAPI train+prove shim at backend/server.py.
//
// Default base: http://localhost:8001 (override with NEXT_PUBLIC_ZKML_URL).
// The shim shells out to train.py and prove.py — the canonical AlphaTrade
// pipeline — so this is the path that produces a *real* model + EZKL proof,
// vs. fakeCID() which generates plausible-looking placeholder strings.

const BASE = process.env.NEXT_PUBLIC_ZKML_URL ?? "http://localhost:8001";

export interface TrainResult {
  weights_dir:   string;
  weights_hash?: string;
  meta:          Record<string, any>;
  files:         string[];
}

export interface ProveJob   { job_id: string; status: "running" | "done" | "failed"; poll?: string; }
export interface ProveStatus {
  status:    "running" | "done" | "failed";
  proof_dir: string;
  bundle?:   Record<string, any>;
  feed?:     Record<string, any>;
  files?:    string[];
  elapsed?:  number;
  error?:    any;
}

export async function pingShim(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/`, { cache: "no-store" });
    return r.ok;
  } catch { return false; }
}

export async function trainModel(opts: {
  job_id: number;
  epochs?: number;
  seed?:   number;
  n_bars?: number;
}): Promise<TrainResult> {
  const r = await fetch(`${BASE}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`train: ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}

export async function startProve(opts: { weights_dir: string; epoch?: number }): Promise<ProveJob> {
  const r = await fetch(`${BASE}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`prove start: ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}

export async function pollProve(jobId: string): Promise<ProveStatus> {
  const r = await fetch(`${BASE}/jobs/${jobId}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`poll: ${r.status}`);
  return r.json();
}

/** Wait for a prove job to reach a terminal state. Polls every 3s up to ~5min. */
export async function awaitProve(jobId: string, onTick?: (s: ProveStatus) => void): Promise<ProveStatus> {
  const start = Date.now();
  while (Date.now() - start < 5 * 60_000) {
    const s = await pollProve(jobId);
    onTick?.(s);
    if (s.status === "done" || s.status === "failed") return s;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error("prove timeout (>5min)");
}

export function artifactUrl(relPath: string): string {
  return `${BASE}/artifact/${relPath.replace(/^\/+/, "")}`;
}

export interface UploadResult {
  mode:     "stub" | "live";
  rootHash: string;
  gateway:  string;
  txHash?:  string;
  bytes?:   number;
  notice?:  string;
}

/** Upload a server-local artifact to 0G Storage. Returns a 0G rootHash
 * that we use as the "CID" for ModelNFT.mintModel. */
export async function uploadTo0G(absPath: string): Promise<UploadResult> {
  const r = await fetch(`${BASE}/upload-0g`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: absPath }),
  });
  if (!r.ok) throw new Error(`upload-0g: ${r.status} ${(await r.text()).slice(0,200)}`);
  return r.json();
}
