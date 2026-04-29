import os
from eth_keys import keys

from zkml.oracle_feed import (
    build_feed,
    merkle_root,
    merkle_proof,
    sign_root,
    verify_root_signature,
    leaf_hash,
    walk,
)


def test_build_feed_is_deterministic_for_seed():
    a = build_feed(seed=42, n_bars=128, n_tokens=5)
    b = build_feed(seed=42, n_bars=128, n_tokens=5)
    assert (a == b).all()


def test_merkle_root_matches_expected_size():
    feed = build_feed(seed=1, n_bars=8, n_tokens=5)
    root = merkle_root(feed)
    assert len(root) == 32


def test_proof_verifies():
    feed = build_feed(seed=2, n_bars=8, n_tokens=5)
    root = merkle_root(feed)
    proof = merkle_proof(feed, idx_bar=3, idx_token=2)
    leaf = leaf_hash(idx_bar=3, idx_token=2, value=int(feed[3, 2]))
    assert walk(leaf, proof) == root


def test_signature_roundtrip():
    pk = keys.PrivateKey(os.urandom(32))
    feed = build_feed(seed=3, n_bars=8, n_tokens=5)
    root = merkle_root(feed)
    sig = sign_root(pk, root, epoch=1)
    addr = pk.public_key.to_checksum_address()
    assert verify_root_signature(addr, root, epoch=1, sig=sig)
