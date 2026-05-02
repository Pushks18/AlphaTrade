import math


class EXP4Bandit:
    """
    Contextual EXP4 bandit for model NFT allocation.
    Arms are model NFTs; context is on-chain metadata (sharpeBps, totalSlashes).
    Weights are updated exponentially from realized hourly returns.
    """

    def __init__(self, eta: float = 0.1):
        self.eta = eta
        self.weights: dict[int, float] = {}

    def _prior(self, model: dict) -> float:
        score = max(float(model.get("sharpeBps", 0)), 0.0)
        slashes = int(model.get("totalSlashes", 0))
        return max(score - slashes * 500.0, 1.0)

    def allocate(self, models: list[dict]) -> list[tuple[int, float]]:
        """Return list of (tokenId, fraction) with fractions summing to 1.0."""
        if not models:
            return []
        for m in models:
            tid = m["tokenId"]
            if tid not in self.weights:
                self.weights[tid] = self._prior(m)
        total = sum(self.weights[m["tokenId"]] for m in models)
        return [(m["tokenId"], self.weights[m["tokenId"]] / total) for m in models]

    def update(self, token_id: int, realized_return: float) -> None:
        """Exponential weight update after observing return for token_id."""
        if token_id not in self.weights:
            self.weights[token_id] = 1.0
        self.weights[token_id] *= math.exp(self.eta * realized_return)
        self.weights[token_id] = min(self.weights[token_id], 1e6)
        self.weights[token_id] = max(self.weights[token_id], 1e-6)
