"""NumPy + onnxruntime reference for Nemotron-3-Diarization.

Mirrors `NemotronAsrStreamingFeatureExtractor`, `Nemotron3DiarizationSpeakerCache` and the
streaming forward of `Nemotron3DiarizationForAudioFrameClassification`. It is the oracle the
browser port in `web/src/lib` is validated against.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = REPO_ROOT / "Nemotron-3-Diarization-ONNX"
LOG_ZERO_GUARD_VALUE = 2.0**-24


# --------------------------------------------------------------------------------------
# Feature extraction
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class FeatureConfig:
    feature_size: int = 128
    sampling_rate: int = 16000
    hop_length: int = 160
    n_fft: int = 512
    win_length: int = 400
    preemphasis: float = 0.97


class FeatureExtractor:
    def __init__(self, config: FeatureConfig = FeatureConfig()):
        self.config = config
        self.mel_filters = librosa.filters.mel(
            sr=config.sampling_rate,
            n_fft=config.n_fft,
            n_mels=config.feature_size,
            fmin=0.0,
            fmax=config.sampling_rate / 2,
            norm="slaney",
        ).astype(np.float32)
        # torch.hann_window(win_length, periodic=False), zero-padded to n_fft and centred
        window = np.hanning(config.win_length).astype(np.float32)
        pad = (config.n_fft - config.win_length) // 2
        self.window = np.pad(window, (pad, config.n_fft - config.win_length - pad)).astype(np.float32)

    def num_frames(self, num_samples: int, center: bool) -> int:
        cfg = self.config
        if center:
            return (num_samples + 2 * (cfg.n_fft // 2) - cfg.n_fft) // cfg.hop_length
        return (num_samples - cfg.n_fft) // cfg.hop_length + 1

    def __call__(self, waveform: np.ndarray, center: bool = True) -> np.ndarray:
        cfg = self.config
        signal = np.asarray(waveform, dtype=np.float32)
        emphasised = signal.copy()
        emphasised[1:] = signal[1:] - cfg.preemphasis * signal[:-1]

        padded = np.pad(emphasised, cfg.n_fft // 2) if center else emphasised
        num_frames = self.num_frames(len(signal), center)
        frames = np.lib.stride_tricks.sliding_window_view(padded, cfg.n_fft)[:: cfg.hop_length][:num_frames]

        spectrum = np.fft.rfft(frames * self.window, n=cfg.n_fft, axis=-1)
        power = (spectrum.real**2 + spectrum.imag**2).astype(np.float32)
        return np.log(power @ self.mel_filters.T + LOG_ZERO_GUARD_VALUE).astype(np.float32)


# --------------------------------------------------------------------------------------
# Arrival-Order Speaker Cache
# --------------------------------------------------------------------------------------


class SpeakerCache:
    """Port of `Nemotron3DiarizationSpeakerCache` for a single stream (batch size 1)."""

    def __init__(self, streaming: dict, hidden_size: int = 512):
        self.fifo_length = streaming["fifo_length"]
        self.speaker_cache_update_period = streaming["speaker_cache_update_period"]
        self.speaker_cache_length = streaming["speaker_cache_length"]
        self.num_silence_frames = streaming["speaker_cache_silence_frames_per_speaker"]
        self.prediction_score_threshold = streaming["prediction_score_threshold"]
        self.latest_frames_score_boost = streaming["latest_frames_score_boost"]
        self.num_speakers = streaming["num_speakers"]
        self.subsampling_factor = streaming["subsampling_factor"]

        budget = self.speaker_cache_length // self.num_speakers - self.num_silence_frames
        self.min_positive_scores = math.floor(budget * streaming["min_positive_scores_rate"])
        self.num_strong_boosted_frames = math.floor(budget * streaming["strong_boost_rate"])
        self.num_weak_boosted_frames = math.floor(budget * streaming["weak_boost_rate"])

        self.embeds = np.zeros((self.speaker_cache_length, hidden_size), dtype=np.float32)
        self.probs = np.zeros((self.speaker_cache_length, self.num_speakers), dtype=np.float32)
        self.fifo = np.zeros((self.fifo_length, hidden_size), dtype=np.float32)
        self.num_cache_frames = 0
        self.num_fifo_frames = 0
        self.is_compressed = False

    def get_embeds(self) -> np.ndarray:
        return np.concatenate([self.embeds[: self.num_cache_frames], self.fifo[: self.num_fifo_frames]], axis=0)

    def _pool_probs(self, logits: np.ndarray) -> np.ndarray:
        factor = self.subsampling_factor
        probs = 1.0 / (1.0 + np.exp(-logits.astype(np.float32)))
        return probs.reshape(-1, factor, probs.shape[-1]).mean(axis=1).astype(np.float32)

    def _num_popped_frames(self, num_fifo_frames: int) -> int:
        if num_fifo_frames <= self.fifo_length:
            return 0
        num_popped = max(self.speaker_cache_update_period, num_fifo_frames - self.fifo_length)
        return min(num_popped, num_fifo_frames)

    def update(self, step_embeds: np.ndarray, step_logits: np.ndarray, silence_embeds: np.ndarray, num_chunk_frames: int):
        num_cache_frames, num_fifo_frames = self.num_cache_frames, self.num_fifo_frames
        probs = self._pool_probs(step_logits)

        chunk_start = num_cache_frames + num_fifo_frames
        chunk_embeds = step_embeds[chunk_start : chunk_start + num_chunk_frames]
        fifo_embeds = np.concatenate([self.fifo[:num_fifo_frames], chunk_embeds], axis=0)

        num_popped = self._num_popped_frames(len(fifo_embeds))
        if num_popped:
            fifo_probs = probs[num_cache_frames : num_cache_frames + len(fifo_embeds)]
            stored_probs = self.probs[:num_cache_frames] if self.is_compressed else probs[:num_cache_frames]
            cache_embeds = np.concatenate([self.embeds[:num_cache_frames], fifo_embeds[:num_popped]], axis=0)
            cache_probs = np.concatenate([stored_probs, fifo_probs[:num_popped]], axis=0)
            fifo_embeds = fifo_embeds[num_popped:]

            if len(cache_embeds) > self.speaker_cache_length:
                cache_embeds, cache_probs = self._compress(cache_embeds, cache_probs, silence_embeds)
                self.is_compressed = True

            self.num_cache_frames = len(cache_embeds)
            self.embeds[: self.num_cache_frames] = cache_embeds
            self.probs[: self.num_cache_frames] = cache_probs

        self.num_fifo_frames = len(fifo_embeds)
        self.fifo[: self.num_fifo_frames] = fifo_embeds

    def _frame_scores(self, probs: np.ndarray) -> np.ndarray:
        threshold = self.prediction_score_threshold
        log_probs = np.log(np.maximum(probs, threshold))
        log_complements = np.log(np.maximum(1.0 - probs, threshold))
        scores = log_probs - log_complements + log_complements.sum(axis=-1, keepdims=True) - math.log(0.5)

        is_speech = probs > 0.5
        scores = np.where(is_speech, scores, -np.inf)
        is_positive = scores > 0
        has_enough_positive = is_positive.sum(axis=0, keepdims=True) >= self.min_positive_scores
        return np.where(~is_positive & is_speech & has_enough_positive, -np.inf, scores)

    @staticmethod
    def _boost_scores(scores: np.ndarray, num_boosted: int, boost: float) -> np.ndarray:
        boosted = scores.copy()
        top = np.argpartition(-scores, num_boosted - 1, axis=0)[:num_boosted]
        np.put_along_axis(boosted, top, np.take_along_axis(scores, top, axis=0) + boost, axis=0)
        return boosted

    def _compress(self, embeds: np.ndarray, probs: np.ndarray, silence_embeds: np.ndarray):
        num_frames, num_speakers = probs.shape

        scores = self._frame_scores(probs)
        scores[self.speaker_cache_length :] += self.latest_frames_score_boost
        scores = self._boost_scores(scores, self.num_strong_boosted_frames, -2.0 * math.log(0.5))
        scores = self._boost_scores(scores, self.num_weak_boosted_frames, -math.log(0.5))
        scores = np.concatenate([scores, np.full((self.num_silence_frames, num_speakers), np.inf)], axis=0)

        embeds = np.concatenate([embeds, silence_embeds.reshape(1, -1)], axis=0)
        probs = np.concatenate([probs, np.zeros((1, num_speakers), dtype=probs.dtype)], axis=0)

        num_scored_frames = num_frames + self.num_silence_frames
        sentinel = num_scored_frames * num_speakers
        flat_scores = scores.T.reshape(-1)

        top = np.argpartition(-flat_scores, self.speaker_cache_length - 1)[: self.speaker_cache_length]
        top = np.where(flat_scores[top] == -np.inf, sentinel, top)
        top = np.sort(top)
        frame_indices = np.where(top == sentinel, num_frames, np.minimum(top % num_scored_frames, num_frames))
        return embeds[frame_indices], probs[frame_indices]


# --------------------------------------------------------------------------------------
# Streaming session
# --------------------------------------------------------------------------------------


class Diarizer:
    def __init__(self, model_file: str = "model.onnx", streaming_mode: str = "low_latency"):
        self.config = json.loads((MODEL_DIR / "config.json").read_text())
        self.processor_config = json.loads((MODEL_DIR / "processor_config.json").read_text())
        self.subsampling_factor = self.config["head_config"]["subsampling_factor"]
        self.chunk_length, self.chunk_right_context = self.processor_config["streaming_modes"][streaming_mode]
        self.features = FeatureExtractor()
        self.session = ort.InferenceSession(str(MODEL_DIR / "onnx" / model_file), providers=["CPUExecutionProvider"])
        self.silence_embeds: np.ndarray | None = None

    @property
    def num_mel_frames_per_audio_chunk(self) -> int:
        return (self.chunk_length + self.chunk_right_context) * self.subsampling_factor

    @property
    def num_mel_frames_per_step(self) -> int:
        return self.chunk_length * self.subsampling_factor

    @property
    def num_samples_first_audio_chunk(self) -> int:
        cfg = self.features.config
        return (self.num_mel_frames_per_audio_chunk - 1) * cfg.hop_length + cfg.win_length // 2

    @property
    def num_samples_per_audio_chunk(self) -> int:
        cfg = self.features.config
        return self.num_mel_frames_per_audio_chunk * cfg.hop_length + cfg.win_length

    def audio_chunk_start(self, mel_frame_idx: int) -> int:
        cfg = self.features.config
        return mel_frame_idx * cfg.hop_length - cfg.n_fft // 2

    def _step(self, cache: SpeakerCache, mel: np.ndarray, num_lookahead_frames: int) -> np.ndarray:
        cached_embeds = cache.get_embeds()
        num_encoder_frames = math.ceil(len(mel) / self.subsampling_factor)
        attention_mask = np.ones((1, len(cached_embeds) + num_encoder_frames), dtype=np.int64)

        logits, chunk_embeds, silence_embeds = self.session.run(
            ["logits", "chunk_embeds", "silence_embeds"],
            {
                "input_features": mel[None].astype(np.float32),
                "cached_embeds": cached_embeds[None].astype(np.float32),
                "attention_mask": attention_mask,
            },
        )
        self.silence_embeds = silence_embeds

        step_embeds = np.concatenate([cached_embeds, chunk_embeds[0]], axis=0)
        num_chunk_frames = num_encoder_frames - num_lookahead_frames
        num_scored = (len(cached_embeds) + num_encoder_frames) * self.subsampling_factor
        cache.update(step_embeds, logits[0][:num_scored], silence_embeds, num_chunk_frames)

        start = len(cached_embeds) * self.subsampling_factor
        end = start + num_chunk_frames * self.subsampling_factor
        # Feature stacking zero-pads the last incomplete encoder frame; those frames are not scored.
        return logits[0][start:end][: len(mel)]

    def diarize(self, audio: np.ndarray) -> np.ndarray:
        """Runs a full streaming session over `audio` and returns per-frame speaker probabilities."""
        cache = SpeakerCache(self.config["streaming_config"])
        step_logits = []

        mel = self.features(audio[: self.num_samples_first_audio_chunk], center=True)
        step_logits.append(self._step(cache, mel, self.chunk_right_context))

        mel_frame_idx = self.num_mel_frames_per_step
        start = self.audio_chunk_start(mel_frame_idx)
        while (end := start + self.num_samples_per_audio_chunk) <= len(audio):
            mel = self.features(audio[start:end], center=False)
            step_logits.append(self._step(cache, mel, self.chunk_right_context))
            mel_frame_idx += self.num_mel_frames_per_step
            start = self.audio_chunk_start(mel_frame_idx)

        tail = audio[start:]
        if self.features.num_frames(len(tail), center=False) > 0:
            mel = self.features(tail, center=False)
            step_logits.append(self._step(cache, mel, 0))

        logits = np.concatenate(step_logits, axis=0)
        return (1.0 / (1.0 + np.exp(-logits))).astype(np.float32)


def extract_segments(probabilities: np.ndarray, threshold: float = 0.5, frame_duration: float = 0.01):
    active = (probabilities > threshold).astype(np.int8)
    padded = np.pad(active, ((1, 1), (0, 0)))
    changes = np.diff(padded, axis=0)

    segments = []
    for speaker in range(changes.shape[1]):
        starts = np.flatnonzero(changes[:, speaker] == 1)
        ends = np.flatnonzero(changes[:, speaker] == -1)
        segments += [
            {"start": round(float(s * frame_duration), 2), "end": round(float(e * frame_duration), 2), "speaker": speaker}
            for s, e in zip(starts, ends)
        ]
    return sorted(segments, key=lambda s: (s["start"], s["speaker"]))


if __name__ == "__main__":
    import sys

    audio_path = sys.argv[1] if len(sys.argv) > 1 else str(REPO_ROOT / ".scratch" / "diarization_example.mp3")
    waveform, _ = librosa.load(audio_path, sr=16000)

    diarizer = Diarizer()
    probabilities = diarizer.diarize(waveform)
    print("probabilities:", probabilities.shape)
    for segment in extract_segments(probabilities):
        print(f"  speaker {segment['speaker']}  {segment['start']:7.2f} -> {segment['end']:7.2f}")
