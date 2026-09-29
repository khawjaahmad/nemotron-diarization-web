import { formatDuration } from "../lib/audio";
import { speakerColor, speakerColorAlpha, speakerLabel } from "../lib/speakerStyle";
import type { Segment } from "../lib/segments";
import { speakingTimes } from "../lib/segments";
import "./SpeakerGrid.css";

export interface SpeakerGridProps {
  numSpeakers: number;
  segments: Segment[];
  levels: Float32Array;
  threshold: number;
}

/** Participant-style tiles, one per speaker channel, lit while that speaker is active. */
export function SpeakerGrid({ numSpeakers, segments, levels, threshold }: SpeakerGridProps) {
  const totals = speakingTimes(segments, numSpeakers);

  return (
    <div className="speakers">
      {Array.from({ length: numSpeakers }, (_, speaker) => (
        <SpeakerTile
          key={speaker}
          speaker={speaker}
          level={levels[speaker] ?? 0}
          speakingSeconds={totals[speaker]}
          isActive={(levels[speaker] ?? 0) > threshold}
          hasSpoken={totals[speaker] > 0}
        />
      ))}
    </div>
  );
}

interface SpeakerTileProps {
  speaker: number;
  level: number;
  speakingSeconds: number;
  isActive: boolean;
  hasSpoken: boolean;
}

function SpeakerTile({ speaker, level, speakingSeconds, isActive, hasSpoken }: SpeakerTileProps) {
  const color = speakerColor(speaker);
  const style = {
    "--tile-color": color,
    "--tile-glow": speakerColorAlpha(speaker, 0.35),
    "--tile-level": `${Math.round(Math.min(1, level) * 100)}%`,
  } as React.CSSProperties;

  return (
    <article
      className="speaker"
      data-active={isActive}
      data-idle={!hasSpoken}
      style={style}
      aria-label={`${speakerLabel(speaker)}, ${isActive ? "speaking" : "silent"}`}
    >
      <div className="speaker__avatar">
        <span>{speaker + 1}</span>
        <div className="speaker__ring" />
      </div>
      <div className="speaker__meta">
        <span className="speaker__name">{speakerLabel(speaker)}</span>
        <span className="speaker__time">{hasSpoken ? formatDuration(speakingSeconds) : "not detected"}</span>
      </div>
      <div className="speaker__level">
        <div className="speaker__level-fill" />
      </div>
    </article>
  );
}
