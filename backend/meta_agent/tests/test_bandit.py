import math
import pytest
from meta_agent.bandit import EXP4Bandit


def _model(token_id, sharpe_bps=4000, slashes=0):
    return {"tokenId": token_id, "sharpeBps": sharpe_bps, "totalSlashes": slashes}


def test_allocate_empty_returns_empty():
    b = EXP4Bandit()
    assert b.allocate([]) == []


def test_allocate_single_model_gets_full_weight():
    b = EXP4Bandit()
    allocs = b.allocate([_model(1)])
    assert len(allocs) == 1
    assert allocs[0][0] == 1
    assert abs(allocs[0][1] - 1.0) < 1e-9


def test_allocate_fractions_sum_to_one():
    b = EXP4Bandit()
    models = [_model(1, 4000), _model(2, 2000), _model(3, 6000)]
    allocs = b.allocate(models)
    total = sum(f for _, f in allocs)
    assert abs(total - 1.0) < 1e-9


def test_allocate_higher_sharpe_gets_more_weight():
    b = EXP4Bandit()
    models = [_model(1, 1000), _model(2, 8000)]
    allocs = dict(b.allocate(models))
    assert allocs[2] > allocs[1]


def test_update_increases_weight_on_positive_return():
    b = EXP4Bandit()
    b.allocate([_model(1)])
    before = b.weights[1]
    b.update(1, 0.05)
    assert b.weights[1] > before


def test_update_decreases_weight_on_negative_return():
    b = EXP4Bandit()
    b.allocate([_model(1)])
    before = b.weights[1]
    b.update(1, -0.05)
    assert b.weights[1] < before


def test_slashed_creator_penalized():
    b = EXP4Bandit()
    models = [_model(1, 5000, slashes=0), _model(2, 5000, slashes=2)]
    allocs = dict(b.allocate(models))
    assert allocs[1] > allocs[2]


def test_weights_stay_in_valid_range():
    b = EXP4Bandit(eta=10.0)
    b.allocate([_model(1)])
    for _ in range(100):
        b.update(1, 1.0)
    assert b.weights[1] <= 1e6
    for _ in range(100):
        b.update(1, -1.0)
    assert b.weights[1] >= 1e-6
