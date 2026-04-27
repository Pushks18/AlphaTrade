#!/usr/bin/env python3
"""
prove.py — ComputeX zkML proof stub (Person B).

In production this would run EZKL to generate a ZK proof that the model
weights were produced by the declared training procedure. For the hackathon MVP
we generate a cryptographic commitment (sha256 of weights + salt) that is
verifiable, deterministic, and fast.

Usage:
    python3 prove.py --weights /tmp/weights_0.json --output /tmp/proof_0.json
"""

import argparse
import hashlib
import json
import os
import time

parser = argparse.ArgumentParser(description="ComputeX zkML prover (stub)")
parser.add_argument("--weights", required=True, help="Path to weights.json")
parser.add_argument("--output",  required=True, help="Path to write proof.json")
args = parser.parse_args()

print("[prove.py] Generating zkML proof…")
t0 = time.time()

# Load weights
with open(args.weights) as f:
    model = json.load(f)

# Simulate proof generation latency
time.sleep(0.3)

# ── Commitment scheme (SHA-256) ───────────────────────────────────────────────
#  In a real EZKL proof, `commitment` would be the Pedersen commitment to the
#  witness, and `proof_bytes` would be the Plonk/Groth16 proof. Here we use
#  sha256 as a lightweight stand-in that is still deterministic and verifiable.

weights_bytes = json.dumps({
    "weights": model["weights"],
    "bias":    model["bias"],
}, sort_keys=True).encode()

# Salt = job_id ensures uniqueness across jobs
salt = f"computex-job-{model['job_id']}".encode()
commitment = hashlib.sha256(weights_bytes + salt).hexdigest()
proof_hash = hashlib.sha256(commitment.encode() + b"-proof").hexdigest()

elapsed = time.time() - t0

proof = {
    "version":    "computex-zkml-v1-stub",
    "job_id":     model["job_id"],
    "model":      model["model"],
    "commitment": commitment,             # sha256(weights || salt)
    "proof_hash": proof_hash,             # sha256(commitment || "-proof")
    "public_inputs": {
        "accuracy":   model["accuracy"],
        "n_samples":  model["n_samples"],
        "window":     model["window"],
    },
    "verified":   True,                   # stub: always valid
    "prover":     "ezkl-stub-v1",
    "proving_time_ms": round(elapsed * 1000, 1),
    "proven_at":  time.time(),
    "note": (
        "This is a stub proof for hackathon demo. "
        "Replace prove.py with real EZKL invocation for production."
    ),
}

os.makedirs(os.path.dirname(args.output), exist_ok=True)
with open(args.output, "w") as f:
    json.dump(proof, f, indent=2)

print(f"  commitment  = {commitment[:32]}…")
print(f"  proof_hash  = {proof_hash[:32]}…")
print(f"  ✅ Proof written → {args.output}  ({elapsed*1000:.0f}ms)")
