import torch

from zkml.model import AlphaMLP
from zkml.oracle_feed import build_feed
from zkml.backtest import run_backtest


def test_run_backtest_outputs_match_feed_length():
    torch.manual_seed(0)
    m = AlphaMLP()
    feed = build_feed(seed=1, n_bars=128, n_tokens=5)
    res = run_backtest(m, feed, lookback=24)
    # one decision per bar after the lookback
    assert res.outputs.shape == (128 - 24, 5)
    # each row sums to ~1 (softmax)
    sums = res.outputs.sum(dim=-1)
    for s in sums:
        assert abs(float(s) - 1.0) < 1e-3


def test_run_backtest_is_deterministic_for_seeded_model():
    torch.manual_seed(0); m1 = AlphaMLP()
    torch.manual_seed(0); m2 = AlphaMLP()
    feed = build_feed(seed=2, n_bars=64, n_tokens=5)
    a = run_backtest(m1, feed, lookback=24)
    b = run_backtest(m2, feed, lookback=24)
    assert torch.allclose(a.outputs, b.outputs)
