"""Run the trained MLP across a price-feed window to produce per-bar
basket weight outputs. The result is what gets committed via outputsHash
in the EZKL audit submission.
"""
from __future__ import annotations
from dataclasses import dataclass

import numpy as np
import torch

from .model import AlphaMLP, NUM_TOKENS
from .oracle_feed import PRICE_DECIMALS


@dataclass
class BacktestResult:
    outputs: torch.Tensor   # (n_bars - lookback, NUM_TOKENS), softmax
    features: torch.Tensor  # (n_bars - lookback, lookback*NUM_TOKENS) raw inputs


def _features_for_bar(feed: np.ndarray, bar_idx: int, lookback: int = 24) -> np.ndarray:
    window = feed[bar_idx - lookback : bar_idx]
    return window.flatten().astype(np.float32) / 10**PRICE_DECIMALS


def run_backtest(model: AlphaMLP, feed: np.ndarray, lookback: int = 24) -> BacktestResult:
    n_bars, n_tokens = feed.shape
    assert n_tokens == NUM_TOKENS, f"feed must have {NUM_TOKENS} cols"
    rows = []
    for bar in range(lookback, n_bars):
        rows.append(_features_for_bar(feed, bar, lookback))
    X = torch.tensor(np.stack(rows), dtype=torch.float32)
    model.eval()
    with torch.no_grad():
        Y = model(X)
    return BacktestResult(outputs=Y, features=X)
