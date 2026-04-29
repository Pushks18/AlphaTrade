"""Parity test: zkml.sharpe.compute_sharpe_bps mirrors PerformanceOracle._sharpe.

The Solidity reference values are computed by SharpeProbe.s.sol (see commit
log) and pasted in. Both implementations operate on int math only, so the
results must agree exactly — any divergence is a bug.
"""
from zkml.sharpe import compute_sharpe_bps


def test_flat_market_sharpe_is_zero():
    outputs = [[5000, 5000, 0, 0, 0]] * 10
    bars = [[100_00000000] * 5] * 11
    sharpe, n = compute_sharpe_bps(outputs, bars)
    assert sharpe == 0
    assert n == 10


def test_single_asset_known_inputs_match_solidity():
    """Single-asset basket: 100% weight on column 0, prices [100, 110, 105, 108].
    Solidity reference value captured by SharpeProbe.s.sol; see commit log."""
    outputs = [[10000, 0, 0, 0, 0]] * 3
    bars = [
        [100_00000000, 0, 0, 0, 0],
        [110_00000000, 0, 0, 0, 0],
        [105_00000000, 0, 0, 0, 0],
        [108_00000000, 0, 0, 0, 0],
    ]
    sharpe, n = compute_sharpe_bps(outputs, bars)
    assert n == 3
    assert sharpe == EXPECTED_SHARPE_4BAR


# Captured from `forge script script/SharpeProbe.s.sol` on commit b04fef5.
# If you change the _sharpe formula in PerformanceOracle, re-run the probe and
# update both this constant and the Solidity tests that depend on it.
EXPECTED_SHARPE_4BAR = 4665
