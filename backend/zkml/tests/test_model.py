import torch
from zkml.model import AlphaMLP, export_to_onnx, weights_hash


def test_alpha_mlp_output_shape():
    m = AlphaMLP()
    x = torch.zeros(1, 120)
    y = m(x)
    assert y.shape == (1, 5), f"got {y.shape}"


def test_alpha_mlp_output_sums_to_one_via_softmax():
    m = AlphaMLP()
    x = torch.randn(8, 120)
    y = m(x)
    sums = y.sum(dim=1)
    for s in sums:
        assert abs(float(s) - 1.0) < 1e-5


def test_export_to_onnx_creates_file(tmp_path):
    out = tmp_path / "model.onnx"
    m = AlphaMLP()
    export_to_onnx(m, out)
    assert out.exists() and out.stat().st_size > 0


def test_weights_hash_deterministic_for_seeded_init(tmp_path):
    torch.manual_seed(0); m1 = AlphaMLP()
    torch.manual_seed(0); m2 = AlphaMLP()
    p = tmp_path / "a.onnx"
    q = tmp_path / "b.onnx"
    export_to_onnx(m1, p)
    export_to_onnx(m2, q)
    assert weights_hash(p) == weights_hash(q)


def test_param_count_under_5k():
    m = AlphaMLP()
    n = sum(p.numel() for p in m.parameters())
    assert n < 5000, f"too many params: {n}"
