import { describe, expect, it } from "vitest";

import { extractSegments } from "../src/lib/segments";
import { deviation, readFloat32, readManifest } from "./fixtures";
import { createDiarizer, diarizeInBlocks } from "./harness";

/** Both paths run the same float32 graph, so only floating-point noise should separate them. */
const TOLERANCE = 2e-3;

describe("streaming diarizer", () => {
  const manifest = readManifest();
  const audio = readFloat32("audio.f32");
  const expected = readFloat32("probabilities.f32");

  it("reproduces the reference probabilities", async () => {
    const probabilities = await diarizeInBlocks(await createDiarizer(), audio, 4096);

    expect(probabilities.length).toBe(expected.length);
    expect(deviation(probabilities, expected).max).toBeLessThan(TOLERANCE);
  }, 300_000);

  it("derives the same speech segments as the reference", () => {
    const segments = extractSegments(expected, manifest.num_speakers);
    expect(segments.length).toBe(manifest.segments.length);

    segments.forEach((segment, index) => {
      const golden = manifest.segments[index];
      expect(segment.speaker).toBe(golden.speaker);
      expect(segment.start).toBeCloseTo(golden.start, 2);
      expect(segment.end).toBeCloseTo(golden.end, 2);
    });
  });

  it("restarts cleanly after a reset", async () => {
    const diarizer = await createDiarizer();
    await diarizer.push(audio.slice(0, 64_000));
    diarizer.reset();

    const frames = await diarizer.push(audio.slice(0, 64_000));
    await diarizer.dispose();

    expect(frames.startFrame).toBe(0);
    expect(frames.numFrames).toBeGreaterThan(0);
    const reference = expected.subarray(0, frames.probabilities.length);
    expect(deviation(frames.probabilities, reference).max).toBeLessThan(TOLERANCE);
  }, 300_000);
});
