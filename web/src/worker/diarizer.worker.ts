import * as ort from "onnxruntime-web";

import { type DiarizationFrames, StreamingDiarizer, loadDiarizerSource } from "../lib/diarizer";
import { latencyMs } from "../lib/modelConfig";
import type { LoadRequest, WorkerRequest, WorkerResponse } from "./protocol";

const MODEL_BASE_URL = import.meta.env.VITE_MODEL_BASE_URL ?? "/models";

/** `serveOrtRuntime` in `vite.config.ts` publishes the WebAssembly runtime under this prefix. */
ort.env.wasm.wasmPaths = "/ort/";
/**
 * Inference already runs off the main thread here, and ORT's WASM thread pool must stay at one:
 * its pthreads would be nested workers, whose script fetches Chrome routes through this worker's
 * event loop. Emscripten blocks that same loop waiting for the pool, so the pool never loads.
 */
ort.env.wasm.numThreads = 1;

interface Session {
  id: number;
  diarizer: StreamingDiarizer;
}

let session: Session | null = null;
/** The most recent load asked for; anything older is discarded when it finishes building. */
let requestedSessionId = 0;
/** Serialises inference so audio blocks are always scored in arrival order. */
let queue: Promise<void> = Promise.resolve();

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function postFrames(id: number, frames: DiarizationFrames, inferenceMs: number): void {
  if (frames.numFrames === 0) return;
  post({ type: "frames", sessionId: id, inferenceMs, ...frames }, [frames.probabilities.buffer]);
}

async function load({ requestId, variant, executionProvider, streamingMode }: LoadRequest): Promise<void> {
  requestedSessionId = requestId;

  // Drop the old session first so a failed build can never leave a released one in place.
  const previous = session;
  session = null;
  await previous?.diarizer.dispose();

  post({ type: "loading", requestId, stage: "Fetching checkpoint" });
  const source = await loadDiarizerSource(MODEL_BASE_URL, variant);

  post({ type: "loading", requestId, stage: "Building inference session" });
  const diarizer = await StreamingDiarizer.create(source, { executionProvider, streamingMode });

  if (requestId !== requestedSessionId) return diarizer.dispose();

  session = { id: requestId, diarizer };
  post({
    type: "ready",
    sessionId: requestId,
    variant,
    executionProvider,
    streamingMode,
    numSpeakers: diarizer.numSpeakers,
    frameDurationSeconds: diarizer.frameDurationSeconds,
    latencyMs: latencyMs(source.config, streamingMode),
  });
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === "load") return load(request);
  // Audio queued against a session that never finished building is dropped, so that the load
  // failure stays the reported error rather than being masked by a follow-up one.
  if (!session) return;

  const { id, diarizer } = session;
  if (request.type === "reset") return diarizer.reset();

  const started = performance.now();
  const frames = request.type === "push" ? await diarizer.push(request.samples) : await diarizer.flush();
  postFrames(id, frames, performance.now() - started);
}

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  queue = queue
    .then(() => handle(data))
    .catch((error: unknown) => post({ type: "error", message: error instanceof Error ? error.message : String(error) }));
};
