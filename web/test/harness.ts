import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StreamingDiarizer } from "../src/lib/diarizer";
import type { CheckpointConfig } from "../src/lib/modelConfig";

const CHECKPOINT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Nemotron-3-Diarization-ONNX");

/** Tests run the float32 graph, so only floating-point noise separates them from the reference. */
const VARIANT = "model";

function readBytes(name: string): Uint8Array {
  const buffer = readFileSync(join(CHECKPOINT_DIR, "onnx", name));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function readCheckpointConfig(): CheckpointConfig {
  const read = (name: string) => JSON.parse(readFileSync(join(CHECKPOINT_DIR, name), "utf8"));
  return { model: read("config.json"), processor: read("processor_config.json") };
}

/** Builds a diarizer straight from the sibling checkpoint, with no HTTP involved. */
export function createDiarizer(): Promise<StreamingDiarizer> {
  return StreamingDiarizer.create(
    {
      config: readCheckpointConfig(),
      model: readBytes(`${VARIANT}.onnx`),
      externalDataName: `${VARIANT}.onnx_data`,
      externalData: readBytes(`${VARIANT}.onnx_data`),
    },
    { executionProvider: "wasm", streamingMode: "low_latency" },
  );
}

/** Streams `audio` through `diarizer` in fixed blocks and returns every probability it emitted. */
export async function diarizeInBlocks(
  diarizer: StreamingDiarizer,
  audio: Float32Array,
  blockSize: number,
): Promise<Float32Array> {
  const chunks: Float32Array[] = [];
  const collect = (probabilities: Float32Array, numFrames: number) => {
    if (numFrames > 0) chunks.push(probabilities);
  };

  for (let offset = 0; offset < audio.length; offset += blockSize) {
    const frames = await diarizer.push(audio.slice(offset, offset + blockSize));
    collect(frames.probabilities, frames.numFrames);
  }
  const tail = await diarizer.flush();
  collect(tail.probabilities, tail.numFrames);
  await diarizer.dispose();

  const probabilities = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    probabilities.set(chunk, cursor);
    cursor += chunk.length;
  }
  return probabilities;
}
