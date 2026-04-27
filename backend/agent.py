#!/usr/bin/env python3
"""
agent.py — ComputeX trading agent (Person B).

Loads a trained model (weights.json) from a local path or 0G Storage CID,
runs inference on the latest price data, generates a trade signal, and
submits the trade via KeeperHub → Uniswap.

Usage:
    # Run with local weights file
    python3 agent.py --weights /tmp/weights_0.json

    # Run with 0G Storage CID (downloads first)
    python3 agent.py --cid bafybeif...

    # Dry-run (no real trade)
    python3 agent.py --weights /tmp/weights_0.json --dry-run
"""

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
import urllib.request

# ── Args ─────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="ComputeX trading agent")
group  = parser.add_mutually_exclusive_group(required=True)
group.add_argument("--weights", help="Path to weights.json")
group.add_argument("--cid",     help="0G Storage CID of weights.json")
parser.add_argument("--dry-run",      action="store_true", help="Print signal but skip trade")
parser.add_argument("--force",        action="store_true", help="Execute trade even at low confidence (demo mode)")
parser.add_argument("--swap-amount",  default="0.05",      help="ETH amount to swap")
parser.add_argument("--from-token",   default="USDC",      help="Token to swap from")
parser.add_argument("--to-token",     default="ETH",       help="Token to swap to")
parser.add_argument("--min-confidence", type=float, default=5.0, help="Min confidence % to trade (default 5)")
args = parser.parse_args()

ZG_URL          = os.getenv("ZG_STORAGE_URL", "")
KEEPERHUB_KEY   = os.getenv("KEEPERHUB_API_KEY", "")
KEEPERHUB_URL   = "https://api.keeperhub.io/v1/workflows"

# ── Load model ────────────────────────────────────────────────────────────────
def load_from_cid(cid: str) -> dict:
    """Download weights.json from 0G Storage by CID."""
    if not ZG_URL:
        raise RuntimeError("ZG_STORAGE_URL not set; cannot download from CID")
    url = f"{ZG_URL}/download/{cid}"
    print(f"  Downloading from 0G Storage: {url}")
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())

if args.weights:
    with open(args.weights) as f:
        model = json.load(f)
elif args.cid:
    model = load_from_cid(args.cid)

print(f"[agent.py] Loaded model: {model['model']}")
print(f"  job_id    = {model['job_id']}")
print(f"  accuracy  = {model['accuracy']}%")
print(f"  loss      = {model['loss']}")

# ── Price feed ────────────────────────────────────────────────────────────────
def fetch_prices(n: int = 10) -> list[float]:
    """
    In production: fetch from Chainlink onchain or a price API.
    For MVP: generate realistic-looking synthetic prices seeded by timestamp.
    """
    seed  = int(time.time() / 60)   # changes every minute
    rng   = random.Random(seed)
    price = 2000.0 + rng.gauss(0, 50)
    prices = []
    for _ in range(n):
        price *= math.exp(rng.gauss(0, 0.003))
        prices.append(round(price, 4))
    return prices

prices = fetch_prices(20)
print(f"\n  Latest prices (synthetic): {prices[-5:]}")

# ── Feature extraction ────────────────────────────────────────────────────────
WINDOW = model["window"]
returns = [math.log(prices[i+1] / prices[i]) for i in range(len(prices)-1)]
if len(returns) < WINDOW:
    print("  ❌ Not enough price data for inference"); sys.exit(1)
features = returns[-WINDOW:]

# ── Inference ─────────────────────────────────────────────────────────────────
def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, z))))

weights = model["weights"]
bias    = model["bias"]
z       = sum(w * x for w, x in zip(weights, features)) + bias
prob_up = sigmoid(z)          # probability that price goes up
confidence = abs(prob_up - 0.5) * 200   # 0→100 confidence

action = "BUY" if prob_up >= 0.5 else "SELL"

print(f"\n{'─'*40}")
print(f"  🧠 Inference result:")
print(f"     P(up)       = {prob_up:.4f}")
print(f"     Signal      = {action}")
print(f"     Confidence  = {confidence:.1f}%")
print(f"{'─'*40}")

if confidence < args.min_confidence and not args.force:
    print("  ⚠️  Confidence too low (<20%) — HOLD, skipping trade")
    sys.exit(0)

# Flip token direction based on signal
from_token = args.from_token if action == "BUY" else args.to_token
to_token   = args.to_token   if action == "BUY" else args.from_token
amount     = args.swap_amount

print(f"\n  Trade: {action} — swap {amount} {from_token} → {to_token}")

if args.dry_run:
    print("  🏳  Dry run — skipping KeeperHub submission")
    sys.exit(0)

# ── KeeperHub submission ──────────────────────────────────────────────────────
def submit_via_keeperhub(from_tok: str, to_tok: str, amt: str) -> str:
    """
    Submit a Uniswap swap via KeeperHub's guaranteed execution API.
    If KEEPERHUB_API_KEY is not set, uses simulation mode.
    """
    if not KEEPERHUB_KEY:
        print("\n  ⚠️  KEEPERHUB_API_KEY not set — running in simulation mode")
        fake_hash = "0x" + hashlib.sha256(f"{from_tok}{to_tok}{amt}{time.time()}".encode()).hexdigest()
        print(f"  📡 [Simulated] KeeperHub workflow created")
        print(f"  📡 [Simulated] Uniswap swap submitted: {from_tok} → {to_tok}")
        time.sleep(0.5)
        print(f"  ✅ [Simulated] Tx confirmed: {fake_hash}")
        return fake_hash

    import urllib.request as req
    payload = json.dumps({
        "steps": [{
            "action": "uniswap.swap",
            "params": {
                "tokenIn":  from_tok,
                "tokenOut": to_tok,
                "amount":   amt,
                "slippage": 0.5,
            }
        }],
        "metadata": { "source": "computex-agent", "confidence": confidence }
    }).encode()

    request = req.Request(
        KEEPERHUB_URL,
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {KEEPERHUB_KEY}",
        },
        method="POST",
    )
    with req.urlopen(request, timeout=30) as r:
        result = json.loads(r.read())
    tx_hash = result.get("txHash") or result.get("hash") or str(result)
    return tx_hash

print("\n  📡 Submitting to KeeperHub…")
tx_hash = submit_via_keeperhub(from_token, to_token, amount)

print(f"\n{'═'*40}")
print(f"  🏆 Trade executed!")
print(f"     Action    : {action}")
print(f"     Swap      : {amount} {from_token} → {to_token}")
print(f"     Confidence: {confidence:.1f}%")
print(f"     Tx hash   : {tx_hash}")
print(f"{'═'*40}")
