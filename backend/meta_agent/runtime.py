"""
Meta-agent runtime: subscribes to PerformanceOracle.AuditAccepted events,
updates the EXP4 bandit, and submits signed trade instructions hourly.

Usage:
    python -m meta_agent.runtime --config config.json

config.json schema:
{
  "rpc_url": "https://arb-sepolia.g.alchemy.com/v2/...",
  "vault_addr": "0x...",
  "operator_key": "0x...",
  "oracle_addr": "0x...",
  "model_dir": "/tmp/ax_train",
  "tick_seconds": 3600,
  "eta": 0.1,
  "score_threshold_bps": 1000
}
"""
import json
import logging
import time
from pathlib import Path

import numpy as np
from web3 import Web3

from .bandit import EXP4Bandit
from .inference import ModelInference
from .keeper_client import KeeperClient

log = logging.getLogger(__name__)

ORACLE_ABI = [
    {
        "name": "AuditAccepted",
        "type": "event",
        "inputs": [
            {"name": "tokenId",   "type": "uint256", "indexed": True},
            {"name": "epoch",     "type": "uint256", "indexed": True},
            {"name": "sharpeBps", "type": "uint256", "indexed": False},
            {"name": "nTrades",   "type": "uint256", "indexed": False},
        ],
    }
]


class MetaAgentRuntime:
    def __init__(self, config: dict):
        self.cfg      = config
        self.w3       = Web3(Web3.HTTPProvider(config["rpc_url"]))
        self.bandit   = EXP4Bandit(eta=config.get("eta", 0.1))
        self.keeper   = KeeperClient(
            config["vault_addr"], config["operator_key"], config["rpc_url"]
        )
        self.models: dict[int, dict] = {}
        self.threshold = config.get("score_threshold_bps", 1000)

    def _fetch_score_events(self, from_block: int = 0) -> list[dict]:
        oracle = self.w3.eth.contract(
            address=Web3.to_checksum_address(self.cfg["oracle_addr"]),
            abi=ORACLE_ABI,
        )
        events = oracle.events.AuditAccepted.get_logs(from_block=from_block)
        updates = []
        for evt in events:
            tid    = evt["args"]["tokenId"]
            sharpe = evt["args"]["sharpeBps"]
            updates.append({"tokenId": tid, "sharpeBps": sharpe, "totalSlashes": 0})
        return updates

    def _eligible_models(self) -> list[dict]:
        return [m for m in self.models.values() if m["sharpeBps"] >= self.threshold]

    def _build_features(self) -> np.ndarray:
        return np.zeros((1, 120), dtype=np.float32)

    def _aggregate_weights(self, allocations: list[tuple[int, float]]) -> list[int]:
        model_dir = Path(self.cfg.get("model_dir", "/tmp/ax_train"))
        features  = self._build_features()
        blended   = np.zeros(5, dtype=np.float64)

        for token_id, fraction in allocations:
            onnx_path = model_dir / f"model_{token_id}.onnx"
            if not onnx_path.exists():
                log.warning("ONNX not found for tokenId %d, skipping", token_id)
                continue
            blended += fraction * ModelInference(str(onnx_path)).predict(features)

        if blended.sum() == 0:
            blended = np.ones(5) / 5

        blended /= blended.sum()
        bps = [int(x * 10_000) for x in blended]
        bps[int(np.argmax(blended))] += 10_000 - sum(bps)
        return bps

    def tick(self) -> str | None:
        updates = self._fetch_score_events()
        for u in updates:
            self.models[u["tokenId"]] = u

        eligible = self._eligible_models()
        if not eligible:
            log.info("No eligible models above threshold %d bps", self.threshold)
            return None

        allocations  = self.bandit.allocate(eligible)
        weights_bps  = self._aggregate_weights(allocations)
        log.info("Submitting trade: weights=%s", weights_bps)
        tx_hash = self.keeper.execute_trade(weights_bps)
        log.info("Trade submitted: %s", tx_hash)
        return tx_hash

    def run(self, tick_seconds: int | None = None):
        interval = tick_seconds or self.cfg.get("tick_seconds", 3600)
        log.info("Meta-agent runtime started (interval=%ds)", interval)
        while True:
            try:
                self.tick()
            except Exception:
                log.exception("Tick failed")
            time.sleep(interval)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.json")
    args = parser.parse_args()
    with open(args.config) as f:
        cfg = json.load(f)
    logging.basicConfig(level=logging.INFO)
    MetaAgentRuntime(cfg).run()


if __name__ == "__main__":
    main()
