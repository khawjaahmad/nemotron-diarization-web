"""Checks the NumPy feature extractor against the torch path of `NemotronAsrStreamingFeatureExtractor`."""

from __future__ import annotations

import librosa
import numpy as np
import torch

from reference import LOG_ZERO_GUARD_VALUE, REPO_ROOT, FeatureExtractor


def torch_features(waveform: np.ndarray, center: bool, extractor: FeatureExtractor) -> np.ndarray:
    cfg = extractor.config
    signal = torch.tensor(waveform, dtype=torch.float32)[None]
    signal = torch.cat([signal[:, :1], signal[:, 1:] - cfg.preemphasis * signal[:, :-1]], dim=1)

    stft = torch.stft(
        signal,
        cfg.n_fft,
        hop_length=cfg.hop_length,
        win_length=cfg.win_length,
        window=torch.hann_window(cfg.win_length, periodic=False),
        return_complex=True,
        pad_mode="constant",
        center=center,
    )
    magnitudes = torch.view_as_real(stft).pow(2).sum(-1)
    mel_spec = torch.from_numpy(extractor.mel_filters) @ magnitudes
    features = torch.log(mel_spec + LOG_ZERO_GUARD_VALUE).permute(0, 2, 1)[0].numpy()
    return features[: extractor.num_frames(len(waveform), center)]


def main() -> None:
    audio = librosa.load(str(REPO_ROOT / ".scratch" / "diarization_example.mp3"), sr=16000)[0][:200000]
    extractor = FeatureExtractor()

    for center, waveform in (("centered", audio[:16680]), ("uncentered", audio[1000:18040])):
        expected = torch_features(waveform, center == "centered", extractor)
        actual = extractor(waveform, center=center == "centered")
        error = np.abs(actual - expected)
        status = "OK " if error.max() < 2e-3 else "FAIL"
        print(f"{status} {center:<12} frames={actual.shape} max_err={error.max():.3e} mean_err={error.mean():.3e}")


if __name__ == "__main__":
    main()
