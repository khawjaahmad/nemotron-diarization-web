import { describe, expect, it } from "vitest";

import { extractSegments } from "../src/lib/segments";
import { createDiarizer, diarizeInBlocks } from "./harness";
import { deviation, readFloat32, readManifest } from "./fixtures";

/**
 * Audio arrives in whatever block size the microphone or file reader hands over, and none of them
 * line up with the model's 1.04 s chunks. Chunking must therefore be driven purely by the internal
 * cursor, never by the caller's block boundaries.
 */
describe("block size independence", () => {
  const audio = readFloat32("audio.f32");
  const manifest = readManifest();

  it("gives identical results for large and small input blocks", async () => {
    const large = await diarizeInBlocks(await createDiarizer(), audio, 160_000);
    const small = await diarizeInBlocks(await createDiarizer(), audio, 1_024);

    expect(large.length).toBe(small.length);
    expect(deviation(large, small).max).toBe(0);
    expect(extractSegments(large, manifest.num_speakers).length).toBe(manifest.segments.length);
  }, 600_000);
});
