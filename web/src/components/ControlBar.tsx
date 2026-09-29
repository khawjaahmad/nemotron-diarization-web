import { useRef } from "react";

import { MicIcon, MicOffIcon, ResetIcon, UploadIcon } from "./icons";
import { WaveformMeter } from "./WaveformMeter";
import "./ControlBar.css";

export interface ControlBarProps {
  isReady: boolean;
  isRecording: boolean;
  isProcessingFile: boolean;
  analyser: AnalyserNode | null;
  threshold: number;
  onToggleMicrophone: () => void;
  onSelectFile: (file: File) => void;
  onReset: () => void;
  onThresholdChange: (threshold: number) => void;
}

/** Floating control pill: microphone, file input, threshold and session reset. */
export function ControlBar({
  isReady,
  isRecording,
  isProcessingFile,
  analyser,
  threshold,
  onToggleMicrophone,
  onSelectFile,
  onReset,
  onThresholdChange,
}: ControlBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = !isReady || isProcessingFile;

  return (
    <div className="controls">
      <button
        type="button"
        className="controls__mic"
        data-recording={isRecording}
        disabled={isBusy}
        onClick={onToggleMicrophone}
      >
        {isRecording ? <MicOffIcon /> : <MicIcon />}
        <span>{isRecording ? "Stop" : "Start"} listening</span>
      </button>

      <WaveformMeter analyser={analyser} />

      <span className="controls__divider" />

      <label className="controls__threshold">
        <span>Threshold</span>
        <input
          type="range"
          min={0.1}
          max={0.9}
          step={0.05}
          value={threshold}
          onChange={(event) => onThresholdChange(Number(event.target.value))}
        />
        <output>{threshold.toFixed(2)}</output>
      </label>

      <span className="controls__divider" />

      <button
        type="button"
        className="controls__action"
        disabled={isBusy || isRecording}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon />
        <span>{isProcessingFile ? "Analysing…" : "Audio file"}</span>
      </button>

      <button type="button" className="controls__action" disabled={!isReady || isRecording} onClick={onReset}>
        <ResetIcon />
        <span>Reset</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onSelectFile(file);
        }}
      />
    </div>
  );
}
