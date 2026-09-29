import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export interface Manifest {
  sampling_rate: number;
  num_audio_samples: number;
  num_mel_bins: number;
  num_speakers: number;
  streaming_mode: string;
  chunk_length: number;
  chunk_right_context: number;
  num_samples_first_audio_chunk: number;
  num_samples_per_audio_chunk: number;
  mel_centered_frames: number;
  mel_uncentered_frames: number;
  num_probability_frames: number;
  segments: { start: number; end: number; speaker: number }[];
}

export function readFloat32(name: string): Float32Array {
  const buffer = readFileSync(join(FIXTURES_DIR, name));
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, "manifest.json"), "utf8")) as Manifest;
}

export interface Deviation {
  max: number;
  mean: number;
}

export function deviation(actual: ArrayLike<number>, expected: ArrayLike<number>): Deviation {
  if (actual.length !== expected.length) {
    throw new Error(`Length mismatch: ${actual.length} vs ${expected.length}`);
  }
  let max = 0;
  let total = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    max = Math.max(max, error);
    total += error;
  }
  return { max, mean: total / actual.length };
}
