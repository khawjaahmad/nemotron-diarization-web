"""Compares each exported ONNX variant against the fp32 baseline on a short excerpt."""

from __future__ import annotations

import time
from pathlib import Path

import librosa
import numpy as np

from reference import MODEL_DIR, REPO_ROOT, Diarizer

VARIANTS = ["model.onnx", "model_fp16.onnx", "model_quantized.onnx", "model_q4.onnx", "model_q4f16.onnx"]
EXCERPT_SECONDS = 30


def main() -> None:
    audio = librosa.load(str(REPO_ROOT / ".scratch" / "diarization_example.mp3"), sr=16000)[0][
        : EXCERPT_SECONDS * 16000
    ]

    baseline = None
    header = f"{'variant':<22}{'size':>9}{'time':>8}{'RTFx':>8}{'max err':>10}{'mean err':>10}"
    print(header)
    print("-" * len(header))

    for variant in VARIANTS:
        size_mb = sum(p.stat().st_size for p in (MODEL_DIR / "onnx").glob(f"{variant}*")) / 1e6
        started = time.perf_counter()
        probabilities = Diarizer(model_file=variant).diarize(audio)
        elapsed = time.perf_counter() - started

        if baseline is None:
            baseline = probabilities
        error = np.abs(probabilities - baseline)
        print(
            f"{variant:<22}{size_mb:>8.0f}M{elapsed:>7.1f}s{EXCERPT_SECONDS / elapsed:>8.1f}"
            f"{error.max():>10.4f}{error.mean():>10.4f}"
        )


if __name__ == "__main__":
    main()
