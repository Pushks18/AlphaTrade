"""Pure-Python Sharpe calculator that mirrors PerformanceOracle._sharpe.

Same int math, same bps units. Parity is verified by test_sharpe_parity
against values produced by a Solidity probe — any divergence between
this and the on-chain implementation is a bug, since they both compute
the same audit score and a mismatch would let creators game the oracle.
"""
from __future__ import annotations
from typing import List, Tuple


def _isqrt(x: int) -> int:
    if x == 0:
        return 0
    z = (x + 1) // 2
    y = x
    while z < y:
        y = z
        z = (x // z + z) // 2
    return y


def compute_sharpe_bps(outputs: List[List[int]], bars: List[List[int]]) -> Tuple[int, int]:
    """outputs: per-bar weight vectors in bps (sum to 10_000).
       bars:    per-bar prices (int, scaled by 1e8).
       Returns (sharpeBps, nTrades). Single-asset simplification: the
       synthetic basket price is the mean over non-zero columns and the
       weight is the mean over non-zero output columns. This matches
       Solidity _sharpe's behavior on identical fixtures."""
    n_bars = len(bars)
    if n_bars < 2:
        return (0, 0)

    rets: List[int] = []
    for i in range(n_bars - 1):
        nz_now = [v for v in bars[i] if v != 0]
        nz_next = [v for v in bars[i + 1] if v != 0]
        if not nz_now or not nz_next:
            continue
        base = sum(nz_now) // len(nz_now)
        nxt = sum(nz_next) // len(nz_next)
        if base == 0:
            continue
        r = ((nxt - base) * 10**8) // base
        nz_w = [w for w in outputs[i] if w != 0]
        if not nz_w:
            continue
        w = sum(nz_w) // len(nz_w)
        rets.append((r * w) // 10_000)

    if not rets:
        return (0, 0)

    n = len(rets)
    mean = sum(rets) // n
    sqsum = sum((x - mean) * (x - mean) for x in rets)
    variance = sqsum // n
    if variance == 0 or mean <= 0:
        return (0, n)
    stddev = _isqrt(variance)
    return ((mean * 10_000) // stddev, n)
