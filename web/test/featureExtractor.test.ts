import { describe, expect, it } from "vitest";

import { FeatureExtractor } from "../src/lib/featureExtractor";
import { createMelFilterBank } from "../src/lib/mel";
import { deviation, readFloat32, readManifest } from "./fixtures";

const manifest = readManifest();
const audio = readFloat32("audio.f32");
const extractor = new FeatureExtractor();

describe("mel filter bank", () => {
  it("matches librosa's slaney-normalised filters", () => {
    const filters = createMelFilterBank({ samplingRate: 16000, nFft: 512, numMelBins: 128 });
    expect(deviation(filters, readFloat32("mel_filters.f32")).max).toBeLessThan(1e-6);
  });
});

describe("feature extractor", () => {
  it("matches the reference on a centred first chunk", () => {
    const chunk = audio.subarray(0, manifest.num_samples_first_audio_chunk);
    const features = extractor.extract(chunk, true);

    expect(features.rows).toBe(manifest.mel_centered_frames);
    expect(features.cols).toBe(manifest.num_mel_bins);
    expect(deviation(features.data, readFloat32("mel_centered.f32")).max).toBeLessThan(2e-3);
  });

  it("matches the reference on an uncentred later chunk", () => {
    const start = manifest.chunk_length * 8 * 160 - 256;
    const chunk = audio.subarray(start, start + manifest.num_samples_per_audio_chunk);
    const features = extractor.extract(chunk, false);

    expect(features.rows).toBe(manifest.mel_uncentered_frames);
    expect(deviation(features.data, readFloat32("mel_uncentered.f32")).max).toBeLessThan(2e-3);
  });

  it("reports the frame count the model expects", () => {
    expect(extractor.numFrames(manifest.num_samples_first_audio_chunk, true)).toBe(manifest.mel_centered_frames);
    expect(extractor.numFrames(manifest.num_samples_per_audio_chunk, false)).toBe(manifest.mel_uncentered_frames);
    expect(extractor.numFrames(0, false)).toBe(0);
  });
});
