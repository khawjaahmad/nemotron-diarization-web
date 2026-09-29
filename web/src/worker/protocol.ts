import type { ExecutionProvider } from "../lib/diarizer";
import type { ModelVariant, StreamingMode } from "../lib/modelConfig";

export interface LoadRequest {
  type: "load";
  /** Identifies the session this load creates, so superseded loads can be discarded. */
  requestId: number;
  variant: ModelVariant;
  executionProvider: ExecutionProvider;
  streamingMode: StreamingMode;
}

export type WorkerRequest =
  | LoadRequest
  | { type: "push"; samples: Float32Array }
  | { type: "flush" }
  | { type: "reset" };

export interface ReadyMessage {
  type: "ready";
  sessionId: number;
  variant: ModelVariant;
  executionProvider: ExecutionProvider;
  streamingMode: StreamingMode;
  numSpeakers: number;
  frameDurationSeconds: number;
  latencyMs: number;
}

export interface FramesMessage {
  type: "frames";
  sessionId: number;
  probabilities: Float32Array;
  numFrames: number;
  numSpeakers: number;
  startFrame: number;
  /** Wall-clock milliseconds the model spent on the chunks in this message. */
  inferenceMs: number;
}

export type WorkerResponse =
  | ReadyMessage
  | FramesMessage
  | { type: "loading"; requestId: number; stage: string }
  | { type: "error"; message: string };
