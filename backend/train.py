#!/usr/bin/env python3
"""
train.py — ComputeX AI training script (Person B).

Trains a simple linear-regression "trend-following" model on synthetic
ETH/USD price data. In production, replace the data source with a real
price feed (e.g. Chainlink, Binance API) and swap the model for an RL agent.

Usage:
    python3 train.py --job-id 0 --output /tmp/weights_0.json
"""

import argparse
import json
import math
import os
import random
import time

# ── Args ─────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="ComputeX model trainer")
parser.add_argument("--job-id",  required=True,  help="GPUMarketplace job ID")
parser.add_argument("--output",  required=True,  help="Path to write weights.json")
parser.add_argument("--epochs",  type=int, default=200, help="Training epochs")
parser.add_argument("--lr",      type=float, default=0.01, help="Learning rate")
args = parser.parse_args()

random.seed(int(args.job_id) + 42)

print(f"[train.py] Job #{args.job_id} — starting training")
print(f"  epochs={args.epochs}  lr={args.lr}")

# ── Synthetic price data ──────────────────────────────────────────────────────
def generate_prices(n: int = 200) -> list[float]:
    """Generate a random walk price series with trend and noise."""
    price = 2000.0
    prices = []
    for _ in range(n):
        drift  = random.gauss(0.0002, 0.001)      # slight upward drift
        noise  = random.gauss(0, 0.005)
        price *= math.exp(drift + noise)
        prices.append(round(price, 4))
    return prices

def make_features(prices: list[float], window: int = 5) -> list[tuple[list[float], float]]:
    """Sliding-window features: [returns over window] → next return."""
    returns = [math.log(prices[i+1] / prices[i]) for i in range(len(prices)-1)]
    samples = []
    for i in range(window, len(returns)):
        X = returns[i-window:i]       # past 5 log-returns
        y = 1.0 if returns[i] > 0 else -1.0   # direction label
        samples.append((X, y))
    return samples

prices  = generate_prices(500)
samples = make_features(prices, window=5)
WINDOW  = 5

# ── Model: linear (logistic-style) with stochastic gradient descent ───────────
weights = [random.gauss(0, 0.01) for _ in range(WINDOW)]
bias    = 0.0

def predict(x: list[float]) -> float:
    """Linear prediction."""
    return sum(w * xi for w, xi in zip(weights, x)) + bias

def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, z))))

def loss_grad(x: list[float], y: float) -> tuple[list[float], float]:
    """Binary cross-entropy gradient."""
    z    = predict(x)
    p    = sigmoid(z)
    t    = (y + 1) / 2          # map {-1,1} → {0,1}
    err  = p - t
    dw   = [err * xi for xi in x]
    db   = err
    return dw, db

print(f"  Generating {len(samples)} training samples from synthetic price data")

losses = []
t0 = time.time()
for epoch in range(args.epochs):
    random.shuffle(samples)
    total_loss = 0.0
    for x, y in samples:
        dw, db = loss_grad(x, y)
        for i in range(WINDOW):
            weights[i] -= args.lr * dw[i]
        bias -= args.lr * db
        z  = predict(x)
        p  = sigmoid(z)
        t_ = (y + 1) / 2
        total_loss += -(t_ * math.log(p + 1e-9) + (1-t_) * math.log(1-p + 1e-9))
    avg_loss = total_loss / len(samples)
    losses.append(avg_loss)
    if epoch % 40 == 0:
        print(f"  epoch {epoch:4d}/{args.epochs}  loss={avg_loss:.4f}")

elapsed = time.time() - t0

# ── Evaluate ──────────────────────────────────────────────────────────────────
correct = sum(1 for x, y in samples if (predict(x) > 0) == (y > 0))
accuracy = correct / len(samples) * 100

print(f"\n  ✅ Training done in {elapsed:.2f}s")
print(f"     Final loss: {losses[-1]:.4f}")
print(f"     Accuracy:   {accuracy:.1f}%")

# ── Save weights ──────────────────────────────────────────────────────────────
output = {
    "job_id":    args.job_id,
    "model":     "LinearTrendFollower-v1",
    "weights":   weights,
    "bias":      bias,
    "window":    WINDOW,
    "accuracy":  round(accuracy, 2),
    "loss":      round(losses[-1], 6),
    "epochs":    args.epochs,
    "lr":        args.lr,
    "n_samples": len(samples),
    "trained_at": time.time(),
}

os.makedirs(os.path.dirname(args.output), exist_ok=True)
with open(args.output, "w") as f:
    json.dump(output, f, indent=2)

print(f"  Weights saved → {args.output}")
