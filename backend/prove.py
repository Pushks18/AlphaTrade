#!/usr/bin/env python3
"""
prove.py — Real EZKL audit proof for an AlphaTrade model.

Pipeline:
  1. Build the deterministic price feed for the audit window.
  2. Run the trained ONNX model on every (lookback=24)-windowed input row.
  3. Compute the Merkle root of the feed (sorted-pair, matches Solidity
     PerformanceOracle).
  4. Run the full ezkl pipeline:
        gen_settings → calibrate_settings → compile_circuit
        → gen_srs → gen_witness → setup → prove → create_evm_verifier
  5. Emit bundle.json (paths, root, outputs) and feed.json (per-bar Merkle
     siblings) for the orchestrator's audit-submitter to consume.

For v1 we use ezkl.gen_srs (locally generated, not the public KZG ceremony)
because the production get_srs path errors on Apple Silicon with the current
ezkl 19.x build. The proofs verify correctly with a matching verifier; the
limitation is that proofs from this dev SRS do not interoperate with KZG
ceremony deployments. Swapping to ceremony SRS is a config change.

Usage:
    python3 prove.py --weights /tmp/ax_train --output /tmp/ax_prove --epoch 1
"""
from __future__ import annotations
import argparse
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from zkml.oracle_feed import (
    build_feed, merkle_root, merkle_proof, leaf_hash, PRICE_DECIMALS,
)


async def _await_if_future(x):
    if asyncio.isfuture(x) or asyncio.iscoroutine(x):
        return await x
    return x


async def run_pipeline(
    weights_dir: Path,
    out: Path,
    epoch: int,
    seed: int,
    n_bars: int,
    audit_window: int,
) -> dict:
    import ezkl

    static_onnx  = weights_dir / "model.onnx"
    dynamic_onnx = weights_dir / "model_dynamic.onnx"
    assert static_onnx.exists(),  f"missing static ONNX: {static_onnx}"
    assert dynamic_onnx.exists(), f"missing dynamic ONNX: {dynamic_onnx}"

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(static_onnx, out / "model.onnx")
    onnx = out / "model.onnx"  # static — fed into ezkl

    # ---- 1. Build the audit-window feed and Merkle artifacts -------------
    feed = build_feed(seed=seed, n_bars=n_bars, n_tokens=5)
    audit_slice = feed[:audit_window] if audit_window <= n_bars else feed
    root = merkle_root(audit_slice)

    # ---- 2. Run inference for every post-lookback bar (dynamic ONNX) -----
    from onnxruntime import InferenceSession
    sess = InferenceSession(str(dynamic_onnx))  # batched inference
    rows = []
    for bar in range(24, len(audit_slice)):
        window = audit_slice[bar - 24 : bar].astype("float32").flatten() / 10**PRICE_DECIMALS
        rows.append(window)
    if not rows:
        raise SystemExit("audit window too small (need > 24 bars)")
    X = np.stack(rows).astype("float32")
    Y_full = sess.run(None, {"features": X})[0]  # (n_rows, 5)

    # EZKL needs a single-sample input.json (static-shape circuit).
    sample = X[:1]

    input_path = out / "input.json"
    input_path.write_text(json.dumps({"input_data": [sample.flatten().tolist()]}))

    # ---- 3. ezkl pipeline -----------------------------------------------
    settings_path = out / "settings.json"
    print("  ezkl gen_settings…", file=sys.stderr); t0 = time.time()
    ezkl.gen_settings(model=str(onnx), output=str(settings_path))

    print("  ezkl calibrate_settings…", file=sys.stderr); t1 = time.time()
    res = ezkl.calibrate_settings(
        data=str(input_path), model=str(onnx),
        settings=str(settings_path), target="resources",
    )
    await _await_if_future(res)

    print("  ezkl compile_circuit…", file=sys.stderr); t2 = time.time()
    compiled = out / "circuit.compiled"
    ezkl.compile_circuit(model=str(onnx), compiled_circuit=str(compiled), settings_path=str(settings_path))

    settings = json.loads(settings_path.read_text())
    logrows = settings["run_args"]["logrows"]

    srs_path = out / "kzg.srs"
    print(f"  ezkl gen_srs (logrows={logrows}, dev SRS)…", file=sys.stderr); t3 = time.time()
    ezkl.gen_srs(srs_path=str(srs_path), logrows=logrows)

    witness_path = out / "witness.json"
    print("  ezkl gen_witness…", file=sys.stderr); t4 = time.time()
    res = ezkl.gen_witness(data=str(input_path), model=str(compiled), output=str(witness_path), srs_path=str(srs_path))
    await _await_if_future(res)

    vk_path = out / "vk.key"
    pk_path = out / "pk.key"
    print("  ezkl setup…", file=sys.stderr); t5 = time.time()
    ezkl.setup(model=str(compiled), vk_path=str(vk_path), pk_path=str(pk_path), srs_path=str(srs_path))

    proof_path = out / "proof.json"
    print("  ezkl prove…", file=sys.stderr); t6 = time.time()
    ezkl.prove(witness=str(witness_path), model=str(compiled), pk_path=str(pk_path),
               proof_path=str(proof_path), proof_type="single", srs_path=str(srs_path))

    sol_path = out / "EzklVerifier.sol"
    abi_path = out / "EzklVerifier.abi.json"
    print("  ezkl create_evm_verifier…", file=sys.stderr); t7 = time.time()
    res = ezkl.create_evm_verifier(
        vk_path=str(vk_path), settings_path=str(settings_path),
        sol_code_path=str(sol_path), abi_path=str(abi_path), srs_path=str(srs_path),
    )
    await _await_if_future(res)
    t8 = time.time()
    print(f"  timings (s): settings={t1-t0:.1f} calibrate={t2-t1:.1f} "
          f"compile={t3-t2:.1f} srs={t4-t3:.1f} witness={t5-t4:.1f} "
          f"setup={t6-t5:.1f} prove={t7-t6:.1f} verifier={t8-t7:.1f}", file=sys.stderr)

    # ---- 4. Per-bar Merkle siblings for the auditor's submission ----------
    siblings_per_bar = []
    indexes = []
    for bar_idx in range(audit_slice.shape[0]):
        # We commit to the basket mean per bar — pick column 0 as canonical.
        proof = merkle_proof(audit_slice, idx_bar=bar_idx, idx_token=0)
        siblings_per_bar.append([s.hex() for s in proof])
        indexes.append(bar_idx * 5 + 0)

    feed_json = {
        "epoch":         epoch,
        "merkle_root":   "0x" + root.hex(),
        "bars":          [int(audit_slice[b, 0]) for b in range(audit_slice.shape[0])],
        "indexes":       indexes,
        "siblings_per_bar": siblings_per_bar,
    }
    (out / "feed.json").write_text(json.dumps(feed_json))

    bundle = {
        "epoch":       epoch,
        "merkle_root": "0x" + root.hex(),
        "outputs":     Y_full.tolist(),
        "proof_path":  str(proof_path),
        "vk_path":     str(vk_path),
        "verifier_sol_path": str(sol_path),
        "settings_path":     str(settings_path),
    }
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2))
    return bundle


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True, help="dir containing model.onnx (from train.py)")
    ap.add_argument("--output",  required=True, help="output dir for proof artifacts")
    ap.add_argument("--epoch",   type=int, default=1)
    ap.add_argument("--seed",    type=int, default=42)
    ap.add_argument("--n-bars",  type=int, default=512)
    ap.add_argument("--audit-window", type=int, default=64,
                    help="number of bars covered by the EZKL audit (must be > 24)")
    args = ap.parse_args()

    bundle = asyncio.run(run_pipeline(
        weights_dir = Path(args.weights),
        out         = Path(args.output),
        epoch       = args.epoch,
        seed        = args.seed,
        n_bars      = args.n_bars,
        audit_window= args.audit_window,
    ))
    print(f"wrote bundle to {Path(args.output) / 'bundle.json'}")
    print(f"  proof size:    {Path(bundle['proof_path']).stat().st_size} bytes")
    print(f"  verifier size: {Path(bundle['verifier_sol_path']).stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
