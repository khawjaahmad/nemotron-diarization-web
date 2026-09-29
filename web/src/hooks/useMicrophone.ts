import { useCallback, useEffect, useRef, useState } from "react";

import { type MicrophoneCapture, captureMicrophone } from "../lib/audio";

/** 128 ms of audio per message at 16 kHz: small enough to feel live, large enough to stay cheap. */
const BLOCK_SIZE = 2048;

export interface MicrophoneControls {
  isRecording: boolean;
  error: string | null;
  analyser: AnalyserNode | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useMicrophone(
  sampleRate: number,
  onBlock: (samples: Float32Array) => void,
  onStopped?: () => void,
): MicrophoneControls {
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const blockRef = useRef(onBlock);
  blockRef.current = onBlock;

  const [isRecording, setIsRecording] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    setIsRecording(false);
    setAnalyser(null);
    if (!capture) return;

    await capture.stop();
    onStopped?.();
  }, [onStopped]);

  const start = useCallback(async () => {
    if (captureRef.current) return;
    setError(null);

    try {
      const capture = await captureMicrophone(sampleRate, BLOCK_SIZE, (samples) => blockRef.current(samples));
      captureRef.current = capture;
      setAnalyser(capture.analyser);
      setIsRecording(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sampleRate]);

  useEffect(() => () => void captureRef.current?.stop(), []);

  return { isRecording, error, analyser, start, stop };
}
