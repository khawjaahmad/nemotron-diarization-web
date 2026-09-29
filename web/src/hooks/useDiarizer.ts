import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExecutionProvider } from "../lib/diarizer";
import type { ModelVariant, StreamingMode } from "../lib/modelConfig";
import { type Segment, extractSegments } from "../lib/segments";
import { ProbabilityTimeline } from "../lib/timeline";
import type { ReadyMessage, WorkerRequest, WorkerResponse } from "../worker/protocol";

/** Frames averaged for the live level meters: a quarter of a second at 10 ms per frame. */
const LEVEL_WINDOW_FRAMES = 25;
/** Speech shorter than this is dropped, which smooths single-frame flicker out of the turn list. */
const MIN_SEGMENT_SECONDS = 0.1;

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface DiarizationState {
  status: EngineStatus;
  stage: string;
  error: string | null;
  info: ReadyMessage | null;
  segments: Segment[];
  levels: Float32Array;
  durationSeconds: number;
  /** Ratio of audio duration to inference time; above 1 means faster than real time. */
  realtimeFactor: number;
}

export interface DiarizerControls extends DiarizationState {
  timeline: ProbabilityTimeline | null;
  revision: number;
  load: (variant: ModelVariant, executionProvider: ExecutionProvider, streamingMode: StreamingMode) => void;
  push: (samples: Float32Array) => void;
  flush: () => void;
  reset: () => void;
}

const INITIAL_STATE: DiarizationState = {
  status: "idle",
  stage: "",
  error: null,
  info: null,
  segments: [],
  levels: new Float32Array(0),
  durationSeconds: 0,
  realtimeFactor: 0,
};

/**
 * Owns the inference worker and the results of the current session.
 *
 * Loads are tagged with a request id and results with the session that produced them, so switching
 * model or backend mid-load can never mix a stale session's output into the timeline.
 */
export function useDiarizer(threshold: number): DiarizerControls {
  const workerRef = useRef<Worker | null>(null);
  const timelineRef = useRef<ProbabilityTimeline | null>(null);
  const requestedSessionRef = useRef(0);
  const activeSessionRef = useRef(-1);
  const inferenceMsRef = useRef(0);

  const [state, setState] = useState<DiarizationState>(INITIAL_STATE);
  const [revision, setRevision] = useState(0);

  const send = useCallback((request: WorkerRequest, transfer: Transferable[] = []) => {
    workerRef.current?.postMessage(request, transfer);
  }, []);

  const clearSession = useCallback(() => {
    timelineRef.current?.clear();
    inferenceMsRef.current = 0;
    setState((previous) => ({
      ...previous,
      segments: [],
      levels: new Float32Array(previous.info?.numSpeakers ?? 0),
      durationSeconds: 0,
      realtimeFactor: 0,
    }));
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("../worker/diarizer.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const fail = (message: string) =>
      setState((previous) => ({ ...previous, status: "error", error: message }));

    // A worker that dies outside a request would otherwise leave the UI waiting forever.
    worker.onerror = (event) => fail(event.message || "The inference worker stopped unexpectedly");
    worker.onmessageerror = () => fail("The inference worker sent a message that could not be read");

    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === "error") return fail(data.message);
      if (data.type === "loading") {
        if (data.requestId !== requestedSessionRef.current) return;
        return setState((previous) => ({ ...previous, status: "loading", stage: data.stage }));
      }
      if (data.type === "ready") {
        if (data.sessionId !== requestedSessionRef.current) return;
        activeSessionRef.current = data.sessionId;
        timelineRef.current = new ProbabilityTimeline(data.numSpeakers, data.frameDurationSeconds);
        inferenceMsRef.current = 0;
        return setState({ ...INITIAL_STATE, status: "ready", info: data, levels: new Float32Array(data.numSpeakers) });
      }

      const timeline = timelineRef.current;
      if (!timeline || data.sessionId !== activeSessionRef.current) return;

      timeline.append(data.probabilities, data.numFrames);
      inferenceMsRef.current += data.inferenceMs;
      setRevision((value) => value + 1);
    };

    return () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Segments and levels are derived, so they follow the timeline rather than living beside it.
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || revision === 0) return;

    setState((previous) => ({
      ...previous,
      segments: extractSegments(timeline.view(), timeline.numSpeakers, {
        threshold,
        frameDurationSeconds: timeline.frameDurationSeconds,
        minDurationSeconds: MIN_SEGMENT_SECONDS,
      }),
      levels: timeline.recentLevels(LEVEL_WINDOW_FRAMES),
      durationSeconds: timeline.durationSeconds,
      realtimeFactor: inferenceMsRef.current > 0 ? (timeline.durationSeconds * 1000) / inferenceMsRef.current : 0,
    }));
  }, [revision, threshold]);

  const controls = useMemo(
    () => ({
      load: (variant: ModelVariant, executionProvider: ExecutionProvider, streamingMode: StreamingMode) => {
        const requestId = requestedSessionRef.current + 1;
        requestedSessionRef.current = requestId;
        activeSessionRef.current = -1;
        setState({ ...INITIAL_STATE, status: "loading", stage: "Starting" });
        send({ type: "load", requestId, variant, executionProvider, streamingMode });
      },
      push: (samples: Float32Array) => send({ type: "push", samples }, [samples.buffer]),
      flush: () => send({ type: "flush" }),
      reset: () => {
        send({ type: "reset" });
        clearSession();
      },
    }),
    [send, clearSession],
  );

  return { ...state, ...controls, timeline: timelineRef.current, revision };
}
