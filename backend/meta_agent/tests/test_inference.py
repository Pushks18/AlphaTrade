import numpy as np
import pytest
from meta_agent.inference import ModelInference


def _make_model(tmp_path):
    """Create a minimal ONNX model (120 inputs → 5 outputs softmax)."""
    import torch
    from zkml.model import AlphaMLP
    model = AlphaMLP()
    model.eval()
    dummy = torch.zeros(1, 120)
    path = str(tmp_path / "test_model.onnx")
    torch.onnx.export(model, dummy, path, input_names=["x"], output_names=["weights"])
    return path


def test_predict_output_shape(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.zeros((1, 120), dtype=np.float32)
    out = inf.predict(features)
    assert out.shape == (5,)


def test_predict_weights_sum_to_one(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.random.rand(1, 120).astype(np.float32)
    out = inf.predict(features)
    assert abs(float(out.sum()) - 1.0) < 1e-5


def test_to_bps_sums_to_10000(tmp_path):
    path = _make_model(tmp_path)
    inf = ModelInference(path)
    features = np.random.rand(1, 120).astype(np.float32)
    bps = inf.to_bps(features)
    assert len(bps) == 5
    assert sum(bps) == 10_000
