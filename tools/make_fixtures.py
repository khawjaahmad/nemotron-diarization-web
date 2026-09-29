"""Dumps golden tensors from `reference.py` for the TypeScript port's tests."""

from __future__ import annotations

import json
from pathlib import Path

import librosa
import numpy as np

from reference import MODEL_DIR, REPO_ROOT, Diarizer, FeatureExtractor, extract_segments

FIXTURES_DIR = REPO_ROOT / "web" / "test" / "fixtures"
AUDIO_PATH = REPO_ROOT / ".scratch" / "diarization_example.mp3"
EXCERPT_SECONDS = 30


def write_float32(name: str, array: np.ndarray) -> None:
    (FIXTURES_DIR / name).write_bytes(np.ascontiguousarray(array, dtype=np.float32).tobytes())
    print(f"  {name:<28} {array.shape}")


def main() -> None:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    audio = librosa.load(str(AUDIO_PATH), sr=16000)[0][: EXCERPT_SECONDS * 16000]

    diarizer = Diarizer()
    features = diarizer.features

    first_chunk = audio[: diarizer.num_samples_first_audio_chunk]
    later_start = diarizer.audio_chunk_start(diarizer.num_mel_frames_per_step)
    later_chunk = audio[later_start : later_start + diarizer.num_samples_per_audio_chunk]

    probabilities = diarizer.diarize(audio)

    print("writing fixtures:")
    write_float32("audio.f32", audio)
    write_float32("mel_filters.f32", features.mel_filters)
    write_float32("window.f32", features.window)
    write_float32("mel_centered.f32", features(first_chunk, center=True))
    write_float32("mel_uncentered.f32", features(later_chunk, center=False))
    write_float32("probabilities.f32", probabilities)

    manifest = {
        "sampling_rate": 16000,
        "num_audio_samples": int(len(audio)),
        "num_mel_bins": features.config.feature_size,
        "num_speakers": diarizer.config["head_config"]["num_speakers"],
        "streaming_mode": "low_latency",
        "chunk_length": diarizer.chunk_length,
        "chunk_right_context": diarizer.chunk_right_context,
        "num_samples_first_audio_chunk": diarizer.num_samples_first_audio_chunk,
        "num_samples_per_audio_chunk": diarizer.num_samples_per_audio_chunk,
        "mel_centered_frames": int(features(first_chunk, center=True).shape[0]),
        "mel_uncentered_frames": int(features(later_chunk, center=False).shape[0]),
        "num_probability_frames": int(probabilities.shape[0]),
        "segments": extract_segments(probabilities),
    }
    (FIXTURES_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"  {'manifest.json':<28} {len(manifest['segments'])} segments")


if __name__ == "__main__":
    main()
