"""Small MLP used for basket weight prediction.

Architecture: 120 → 32 → 16 → 5 with ReLU and softmax output. Sized so EZKL
can prove inference in well under a minute on a laptop while remaining
expressive enough for a 5-token rotation strategy.
"""
from __future__ import annotations
import hashlib
from pathlib import Path

import torch
import torch.nn as nn

NUM_FEATURES = 120
NUM_TOKENS = 5


class AlphaMLP(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(NUM_FEATURES, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, NUM_TOKENS),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.net(x)
        return torch.softmax(logits, dim=-1)


def export_to_onnx(model: nn.Module, out_path: Path) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    dummy = torch.zeros(1, NUM_FEATURES)
    torch.onnx.export(
        model,
        dummy,
        str(out_path),
        input_names=["features"],
        output_names=["weights"],
        opset_version=13,
        dynamic_axes={"features": {0: "batch"}, "weights": {0: "batch"}},
    )
    return out_path


def weights_hash(onnx_path: Path) -> str:
    """Deterministic hash of the ONNX bytes for binding the model identity.

    We use SHA3-256 (vs keccak256 used on chain) — parity with on-chain
    keccak is enforced at proving time when ezkl recomputes the canonical
    hash over the same bytes. For these unit tests, only determinism matters.
    """
    h = hashlib.sha3_256()
    with open(onnx_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return "0x" + h.hexdigest()
