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

/** Docked control bar: microphone, file input, threshold and session reset. */
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

  const caption = isRecording
    ? "Listening"
    : isProcessingFile
      ? "Analysing file"
      : isReady
        ? "Ready to listen"
        : "Loading model";

  return (
    <div className="controls">
      <div className="controls__now">
        <button
          type="button"
          className="controls__mic"
          data-recording={isRecording}
          disabled={isBusy}
          onClick={onToggleMicrophone}
          aria-label={isRecording ? "Stop listening" : "Start listening"}
        >
          {isRecording ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
        </button>
        <div className="controls__caption">
          <strong>{caption}</strong>
          {isRecording ? <WaveformMeter analyser={analyser} /> : <span>Microphone or audio file</span>}
        </div>
      </div>

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

      <div className="controls__actions">
        <button
          type="button"
          className="controls__action"
          disabled={isBusy || isRecording}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
          <span className="controls__action-label">{isProcessingFile ? "Analysing…" : "Audio file"}</span>
        </button>

        <button
          type="button"
          className="controls__action"
          disabled={!isReady || isRecording}
          onClick={onReset}
        >
          <ResetIcon />
          <span className="controls__action-label">Reset</span>
        </button>
      </div>

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
