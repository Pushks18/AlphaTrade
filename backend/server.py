#!/usr/bin/env python3
"""
server.py — FastAPI shim around train.py / prove.py.

The frontend talks to this service to trigger real training + proof
generation, replacing the fakeCID() placeholders. Each endpoint shells
out to the existing CLI scripts so the production code path remains
the canonical one — this is a thin REST veneer.

Endpoints:
    POST /train             { job_id, epochs?, seed? }   →  { weights_dir, weights_hash, meta }
    POST /prove             { weights_dir, epoch }        →  { proof_dir, bundle, feed }
    GET  /artifact/{path}                                 →  file download (for IPFS/0G upload)
    GET  /jobs/{job_id}                                   →  status of a long-running job

Usage:
    cd backend && python3 -m uvicorn server:app --reload --port 8001
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

ROOT          = Path(__file__).resolve().parent
TRAIN_SCRIPT  = ROOT / "train.py"
PROVE_SCRIPT  = ROOT / "prove.py"
ARTIFACT_ROOT = Path(os.getenv("ALPHATRADE_ARTIFACT_DIR", "/tmp/alphatrade")).resolve()
ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AlphaTrade train+prove shim", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Job tracking ─────────────────────────────────────────────────────────────
# Long-running prove() calls are run in a background thread; the frontend
# polls /jobs/{id} until done.
JOBS: dict[str, dict[str, Any]] = {}


def _run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run a subprocess and capture both streams. Raises on nonzero exit."""
    res = subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "cmd":      " ".join(cmd),
                "stdout":   res.stdout[-2000:],
                "stderr":   res.stderr[-2000:],
                "exitcode": res.returncode,
            },
        )
    return res


# ── Models ───────────────────────────────────────────────────────────────────
class TrainRequest(BaseModel):
    job_id: int
    epochs: int = 20
    seed:   int = 42
    n_bars: int = 512

class ProveRequest(BaseModel):
    weights_dir: str
    epoch:       int = 1

class UploadRequest(BaseModel):
    path: str   # absolute path on the FS, must be under ARTIFACT_ROOT for safety


# ── Endpoints ────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "service": "alphatrade-train-prove",
        "endpoints": ["/train", "/prove", "/artifact/{path}", "/jobs/{id}"],
        "scripts": {"train": str(TRAIN_SCRIPT), "prove": str(PROVE_SCRIPT)},
        "artifact_root": str(ARTIFACT_ROOT),
    }

@app.post("/train")
def train(req: TrainRequest):
    """Train a model. Synchronous — train.py finishes in ~30s on M4."""
    out_dir = ARTIFACT_ROOT / f"train_{req.job_id}_{int(time.time())}"
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable, str(TRAIN_SCRIPT),
        "--job-id", str(req.job_id),
        "--output", str(out_dir),
        "--epochs", str(req.epochs),
        "--seed",   str(req.seed),
        "--n-bars", str(req.n_bars),
    ]
    res = _run(cmd)

    meta_path = out_dir / "meta.json"
    if not meta_path.exists():
        raise HTTPException(500, f"train.py did not emit meta.json: {res.stdout[-500:]}")
    meta = json.loads(meta_path.read_text())

    return {
        "weights_dir":   str(out_dir),
        "weights_hash":  meta.get("weightsHash"),
        "meta":          meta,
        "files": [p.name for p in out_dir.iterdir() if p.is_file()],
    }


@app.post("/prove")
def prove(req: ProveRequest):
    """Kick off a proof generation job. Returns immediately with a job id;
    poll /jobs/{id} for completion. EZKL on M4 takes 60–120s."""
    weights_dir = Path(req.weights_dir).resolve()
    if not (weights_dir / "model.onnx").exists():
        raise HTTPException(400, f"weights_dir missing model.onnx: {weights_dir}")

    proof_dir = ARTIFACT_ROOT / f"prove_{weights_dir.name}_{int(time.time())}"
    proof_dir.mkdir(parents=True, exist_ok=True)

    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"status": "running", "started_at": time.time(), "proof_dir": str(proof_dir)}

    def _runner():
        try:
            cmd = [
                sys.executable, str(PROVE_SCRIPT),
                "--weights", str(weights_dir),
                "--output",  str(proof_dir),
                "--epoch",   str(req.epoch),
            ]
            _run(cmd)
            bundle = json.loads((proof_dir / "bundle.json").read_text()) if (proof_dir / "bundle.json").exists() else {}
            feed   = json.loads((proof_dir / "feed.json").read_text())   if (proof_dir / "feed.json").exists()   else {}
            JOBS[job_id].update({
                "status":   "done",
                "proof_dir": str(proof_dir),
                "bundle":    bundle,
                "feed":      feed,
                "files":     [p.name for p in proof_dir.iterdir() if p.is_file()],
                "elapsed":   time.time() - JOBS[job_id]["started_at"],
            })
        except HTTPException as e:
            JOBS[job_id].update({ "status": "failed", "error": e.detail })
        except Exception as e:
            JOBS[job_id].update({ "status": "failed", "error": str(e) })

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    return { "job_id": job_id, "status": "running", "poll": f"/jobs/{job_id}" }


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "unknown job_id")
    return JOBS[job_id]


UPLOAD_SCRIPT = ROOT / "upload_0g.mjs"

@app.post("/upload-0g")
def upload_0g(req: UploadRequest):
    """Upload a local artifact to 0G Storage. Shells out to upload_0g.js
    (which uses @0glabs/0g-ts-sdk). Falls back to a stub rootHash if
    ZG_PRIVATE_KEY isn't configured — the response always includes a
    'mode' field so the UI can label it 'stub' vs 'live'."""
    target = Path(req.path).resolve()
    if not str(target).startswith(str(ARTIFACT_ROOT)):
        raise HTTPException(400, "path must be under ARTIFACT_ROOT")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"no such file: {req.path}")

    res = subprocess.run(
        ["node", str(UPLOAD_SCRIPT), str(target)],
        capture_output=True, text=True,
        env={**os.environ},   # passes ZG_PRIVATE_KEY / ZG_RPC_URL through
    )
    line = (res.stdout or "").strip().splitlines()[-1] if res.stdout else "{}"
    try:
        out = json.loads(line)
    except json.JSONDecodeError:
        raise HTTPException(500, f"upload_0g.js produced non-JSON: {res.stdout[-300:]} / {res.stderr[-300:]}")
    if "error" in out:
        raise HTTPException(500, out)
    return out


@app.get("/artifact/{path:path}")
def artifact(path: str):
    """Serve any artifact file rooted at ARTIFACT_ROOT for IPFS/0G upload.
    Path is treated relative to ARTIFACT_ROOT to avoid path traversal."""
    target = (ARTIFACT_ROOT / path).resolve()
    if not str(target).startswith(str(ARTIFACT_ROOT)):
        raise HTTPException(400, "path escapes artifact root")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"no such artifact: {path}")
    return FileResponse(target)
