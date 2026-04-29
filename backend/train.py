#!/usr/bin/env python3
"""
train.py — AlphaTrade AI training script.

Trains the AlphaMLP basket-rotation policy on a deterministic synthetic
price feed and exports the resulting model to ONNX. The hash of the ONNX
file is committed to ModelNFT at mint time so the on-chain audit can
bind the SNARK proof to a specific model identity.

Outputs (under --output dir):
    model.onnx          — static-shape ONNX (1, 120) -> (1, 5) used by EZKL
    model_dynamic.onnx  — dynamic batch axis, used at serving time
    meta.json           — { jobId, weightsHash, feedSeed, trainedEpochs, trainedAt, nBars }

Invoked by the orchestrator once a GPU-rental job is created.
"""
from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

import torch

# Make sibling zkml package importable when run as a script from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from zkml.model import AlphaMLP, export_to_onnx, weights_hash, NUM_TOKENS
from zkml.oracle_feed import build_feed, PRICE_DECIMALS

import numpy as np


def _make_features(feed: np.ndarray, lookback: int = 24) -> torch.Tensor:
    """Build (T-lookback, lookback*NUM_TOKENS) feature matrix."""
    rows = []
    for bar in range(lookback, feed.shape[0]):
        rows.append(feed[bar - lookback : bar].astype("float32").flatten() / 10**PRICE_DECIMALS)
    return torch.tensor(np.stack(rows), dtype=torch.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--job-id", required=True, type=int)
    ap.add_argument("--output", required=True, type=str, help="output directory")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--seed",   type=int, default=42)
    ap.add_argument("--n-bars", type=int, default=512)
    args = ap.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(args.seed)
    model = AlphaMLP()
    feed = build_feed(seed=args.seed, n_bars=args.n_bars, n_tokens=NUM_TOKENS)

    feed_t = torch.tensor(feed, dtype=torch.float32)
    prices = feed_t[24:]                                # (T, NUM_TOKENS)
    next_ret = (prices[1:] - prices[:-1]) / prices[:-1] # (T-1, NUM_TOKENS)

    X = _make_features(feed, lookback=24)               # (T, 120)

    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    model.train()
    for ep in range(args.epochs):
        Y = model(X)                                    # (T, 5), softmax
        wY = Y[:-1]                                     # align with next_ret
        loss = -(wY * next_ret).sum(dim=-1).mean()
        opt.zero_grad(); loss.backward(); opt.step()
        if ep == 0 or (ep + 1) == args.epochs:
            print(f"  epoch {ep+1:>3}/{args.epochs}  loss={float(loss):+.6f}", file=sys.stderr)

    static_onnx  = out / "model.onnx"
    dynamic_onnx = out / "model_dynamic.onnx"
    export_to_onnx(model, static_onnx,  static=True)
    export_to_onnx(model, dynamic_onnx, static=False)

    meta = {
        "jobId":         args.job_id,
        "weightsHash":   weights_hash(static_onnx),
        "feedSeed":      args.seed,
        "trainedEpochs": args.epochs,
        "trainedAt":     int(time.time()),
        "nBars":         args.n_bars,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote {static_onnx} and meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
