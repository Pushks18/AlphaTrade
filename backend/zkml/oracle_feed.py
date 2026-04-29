"""Deterministic synthetic price feed + sorted-pair Merkle commitment + ECDSA sig.

For v1 we generate the feed deterministically from a seed (so backtests are
reproducible). v2 swaps in real Pyth bars; the Merkle / signature layer is
unchanged. Leaf encoding mirrors PerformanceOracle's:
keccak256(uint32(bar*n_tokens + token) ‖ int256(value)).
"""
from __future__ import annotations
from typing import List

import numpy as np
from eth_keys import keys
from eth_utils import keccak

PRICE_DECIMALS = 8  # matches solidity int256(value * 1e8)
DEFAULT_N_TOKENS = 5


def build_feed(seed: int, n_bars: int, n_tokens: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    rets = rng.normal(loc=0.0, scale=0.01, size=(n_bars - 1, n_tokens))
    rets = np.clip(rets, -0.05, 0.05)
    levels = np.empty((n_bars, n_tokens), dtype=np.float64)
    levels[0] = 1.0
    for i in range(1, n_bars):
        levels[i] = levels[i - 1] * (1.0 + rets[i - 1])
    return (levels * 100.0 * (10 ** PRICE_DECIMALS)).astype(np.int64)


def leaf_hash(idx_bar: int, idx_token: int, value: int, n_tokens: int = DEFAULT_N_TOKENS) -> bytes:
    flat_idx = idx_bar * n_tokens + idx_token
    return keccak(
        flat_idx.to_bytes(4, "big") + int(value).to_bytes(32, "big", signed=True)
    )


def _hash_pair(a: bytes, b: bytes) -> bytes:
    return keccak(a + b) if a < b else keccak(b + a)


def _all_leaves(feed: np.ndarray) -> List[bytes]:
    n_bars, n_tokens = feed.shape
    leaves: List[bytes] = []
    for b in range(n_bars):
        for t in range(n_tokens):
            leaves.append(leaf_hash(b, t, int(feed[b, t]), n_tokens=n_tokens))
    return leaves


def merkle_root(feed: np.ndarray) -> bytes:
    layer = _all_leaves(feed)
    while len(layer) > 1:
        nxt: List[bytes] = []
        for i in range(0, len(layer), 2):
            a = layer[i]
            b = layer[i + 1] if i + 1 < len(layer) else layer[i]
            nxt.append(_hash_pair(a, b))
        layer = nxt
    return layer[0]


def merkle_proof(feed: np.ndarray, idx_bar: int, idx_token: int) -> List[bytes]:
    n_bars, n_tokens = feed.shape
    flat = idx_bar * n_tokens + idx_token
    layer = _all_leaves(feed)
    proof: List[bytes] = []
    while len(layer) > 1:
        sibling_idx = flat ^ 1
        if sibling_idx >= len(layer):
            sibling_idx = flat  # duplicate-self at right edge
        proof.append(layer[sibling_idx])
        nxt: List[bytes] = []
        for i in range(0, len(layer), 2):
            a = layer[i]
            b = layer[i + 1] if i + 1 < len(layer) else layer[i]
            nxt.append(_hash_pair(a, b))
        layer = nxt
        flat //= 2
    return proof


def walk(leaf: bytes, proof: List[bytes]) -> bytes:
    cur = leaf
    for sib in proof:
        cur = _hash_pair(cur, sib)
    return cur


def sign_root(pk: keys.PrivateKey, root: bytes, epoch: int) -> bytes:
    msg = keccak(epoch.to_bytes(8, "big") + root)
    return pk.sign_msg_hash(msg).to_bytes()


def verify_root_signature(addr: str, root: bytes, epoch: int, sig: bytes) -> bool:
    msg = keccak(epoch.to_bytes(8, "big") + root)
    pub = keys.Signature(sig).recover_public_key_from_msg_hash(msg)
    return pub.to_checksum_address().lower() == addr.lower()
