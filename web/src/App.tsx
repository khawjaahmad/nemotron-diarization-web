import { useCallback, useEffect, useMemo, useState } from "react";

import { ActivityTimeline } from "./components/ActivityTimeline";
import { ControlBar } from "./components/ControlBar";
import { SegmentList } from "./components/SegmentList";
import { SpeakerGrid } from "./components/SpeakerGrid";
import { TopBar } from "./components/TopBar";
import { useDiarizer } from "./hooks/useDiarizer";
import { useMicrophone } from "./hooks/useMicrophone";
import { decodeAudioFile } from "./lib/audio";
import type { ExecutionProvider } from "./lib/diarizer";
import { type ModelVariant, type StreamingMode, defaultVariantFor } from "./lib/modelConfig";
import "./App.css";

const SAMPLE_RATE = 16000;
/** Samples handed to the worker per step when replaying a file: 10 s of audio. */
const FILE_BLOCK_SIZE = SAMPLE_RATE * 10;
const LIVE_WINDOW_SECONDS = 45;

function detectProviders(): ExecutionProvider[] {
  return "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
}

export default function App() {
  const providers = useMemo(detectProviders, []);
  const [executionProvider, setExecutionProvider] = useState<ExecutionProvider>(providers[0]);
  const [variant, setVariant] = useState<ModelVariant>(() => defaultVariantFor(providers[0]));
  const [streamingMode, setStreamingMode] = useState<StreamingMode>("low_latency");
  const [threshold, setThreshold] = useState(0.5);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const diarizer = useDiarizer(threshold);
  const { load, push, flush, reset } = diarizer;

  useEffect(() => {
    load(variant, executionProvider, streamingMode);
  }, [load, variant, executionProvider, streamingMode]);

  const changeExecutionProvider = useCallback((provider: ExecutionProvider) => {
    setExecutionProvider(provider);
    setVariant(defaultVariantFor(provider));
  }, []);

  const microphone = useMicrophone(SAMPLE_RATE, push, flush);

  const toggleMicrophone = useCallback(async () => {
    if (microphone.isRecording) return microphone.stop();
    reset();
    await microphone.start();
  }, [microphone, reset]);

  const analyseFile = useCallback(
    async (file: File) => {
      setIsProcessingFile(true);
      try {
        reset();
        const samples = await decodeAudioFile(file, SAMPLE_RATE);
        for (let offset = 0; offset < samples.length; offset += FILE_BLOCK_SIZE) {
          push(samples.slice(offset, offset + FILE_BLOCK_SIZE));
        }
        flush();
      } finally {
        setIsProcessingFile(false);
      }
    },
    [flush, push, reset],
  );

  const isReady = diarizer.status === "ready";
  const isLive = microphone.isRecording;
  const numSpeakers = diarizer.info?.numSpeakers ?? 8;
  const error = diarizer.error ?? microphone.error;

  return (
    <div className="app">
      <TopBar
        status={diarizer.status}
        stage={diarizer.stage}
        variant={variant}
        executionProvider={executionProvider}
        availableProviders={providers}
        streamingMode={streamingMode}
        realtimeFactor={diarizer.realtimeFactor}
        locked={isLive || isProcessingFile}
        onVariantChange={setVariant}
        onExecutionProviderChange={changeExecutionProvider}
        onStreamingModeChange={setStreamingMode}
      />

      {error && <p className="app__error">{error}</p>}

      <main className="app__main">
        <section className="app__stage">
          <SpeakerGrid
            numSpeakers={numSpeakers}
            segments={diarizer.segments}
            levels={diarizer.levels}
            threshold={threshold}
          />
          <ActivityTimeline
            timeline={diarizer.timeline}
            revision={diarizer.revision}
            threshold={threshold}
            windowSeconds={LIVE_WINDOW_SECONDS}
            follow={isLive}
          />
        </section>

        <aside className="app__side">
          <SegmentList segments={diarizer.segments} follow={isLive} />
        </aside>
      </main>

      <footer className="app__footer">
        <ControlBar
          isReady={isReady}
          isRecording={isLive}
          isProcessingFile={isProcessingFile}
          analyser={microphone.analyser}
          threshold={threshold}
          onToggleMicrophone={toggleMicrophone}
          onSelectFile={analyseFile}
          onReset={reset}
          onThresholdChange={setThreshold}
        />
      </footer>
    </div>
  );
}
