import numpy as np


class ModelInference:
    """Wraps an ONNX AlphaMLP model for live inference."""

    def __init__(self, onnx_path: str):
        import onnxruntime as ort
        self.session = ort.InferenceSession(onnx_path)
        self._input_name = self.session.get_inputs()[0].name

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Run model and return 5-dim softmax weight vector (sums to ~1)."""
        if features.ndim == 1:
            features = features.reshape(1, -1)
        out = self.session.run(None, {self._input_name: features.astype(np.float32)})
        return out[0][0]

    def to_bps(self, features: np.ndarray) -> list[int]:
        """Convert model output to integer basis-point allocation summing to 10_000."""
        weights = self.predict(features)
        bps = [int(w * 10_000) for w in weights]
        diff = 10_000 - sum(bps)
        bps[int(np.argmax(weights))] += diff
        return bps
