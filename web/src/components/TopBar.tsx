import type { ExecutionProvider } from "../lib/diarizer";
import { type ModelVariant, type StreamingMode, VARIANT_INFO, variantsFor } from "../lib/modelConfig";
import type { EngineStatus } from "../hooks/useDiarizer";
import { SparkIcon } from "./icons";
import "./TopBar.css";

const STREAMING_MODE_LABELS: Record<StreamingMode, string> = {
  ultra_low_latency: "Ultra low · 320 ms",
  very_low_latency: "Very low · 640 ms",
  low_latency: "Low · 1040 ms",
  offline: "Offline · 30.4 s",
};

export interface TopBarProps {
  status: EngineStatus;
  stage: string;
  variant: ModelVariant;
  executionProvider: ExecutionProvider;
  availableProviders: ExecutionProvider[];
  streamingMode: StreamingMode;
  realtimeFactor: number;
  locked: boolean;
  onVariantChange: (variant: ModelVariant) => void;
  onExecutionProviderChange: (provider: ExecutionProvider) => void;
  onStreamingModeChange: (mode: StreamingMode) => void;
}

export function TopBar({
  status,
  stage,
  variant,
  executionProvider,
  availableProviders,
  streamingMode,
  realtimeFactor,
  locked,
  onVariantChange,
  onExecutionProviderChange,
  onStreamingModeChange,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__mark">
          <SparkIcon size={18} />
        </span>
        <div>
          <h1>Nemotron 3 Diarization</h1>
          <p>Streaming speaker diarization, running entirely in your browser</p>
        </div>
      </div>

      <div className="topbar__settings">
        <Field label="Precision">
          <select
            value={variant}
            disabled={locked}
            onChange={(event) => onVariantChange(event.target.value as ModelVariant)}
          >
            {variantsFor(executionProvider).map((option) => (
              <option key={option} value={option}>
                {VARIANT_INFO[option].label} · {VARIANT_INFO[option].sizeMb} MB
              </option>
            ))}
          </select>
        </Field>

        <Field label="Backend">
          <select
            value={executionProvider}
            disabled={locked}
            onChange={(event) => onExecutionProviderChange(event.target.value as ExecutionProvider)}
          >
            {availableProviders.map((provider) => (
              <option key={provider} value={provider}>
                {provider === "webgpu" ? "WebGPU" : "WASM"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Latency">
          <select
            value={streamingMode}
            disabled={locked}
            onChange={(event) => onStreamingModeChange(event.target.value as StreamingMode)}
          >
            {Object.entries(STREAMING_MODE_LABELS).map(([mode, label]) => (
              <option key={mode} value={mode}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <StatusPill status={status} stage={stage} realtimeFactor={realtimeFactor} />
      </div>
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="topbar__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status, stage, realtimeFactor }: { status: EngineStatus; stage: string; realtimeFactor: number }) {
  const text = {
    idle: "Idle",
    loading: stage || "Loading",
    error: "Error",
    ready: realtimeFactor > 0 ? `${realtimeFactor.toFixed(1)}× realtime` : "Ready",
  }[status];

  return (
    <span className="topbar__status" data-status={status}>
      <span className="topbar__dot" />
      {text}
    </span>
  );
}
