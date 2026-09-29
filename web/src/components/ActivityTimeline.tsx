import { useEffect, useRef } from "react";

import { formatTimestamp } from "../lib/audio";
import { speakerColor, speakerColorAlpha } from "../lib/speakerStyle";
import type { ProbabilityTimeline } from "../lib/timeline";
import "./ActivityTimeline.css";

/** Must match the row gap of `.timeline__labels` so lane names line up with their lanes. */
const LANE_GAP = 6;
/** Mirror `--surface-2` and `--text-faint` in theme.css. */
const LANE_BACKGROUND = "#1f1f1f";
const AXIS_TEXT_COLOR = "#7c7c7c";
const AXIS_FONT = "11px ui-monospace, Menlo, monospace";

export interface ActivityTimelineProps {
  timeline: ProbabilityTimeline | null;
  /** Bumped whenever the timeline grows, since its buffer is mutated in place. */
  revision: number;
  threshold: number;
  /** Seconds kept on screen while following a live stream. */
  windowSeconds: number;
  follow: boolean;
}

/**
 * Per-speaker activity lanes. Each column shows the strongest probability in the frames it covers,
 * so quiet stretches fade out instead of disappearing.
 */
export function ActivityTimeline({ timeline, revision, threshold, windowSeconds, follow }: ActivityTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !timeline) return;

    const render = () => draw(context, canvas, timeline, { threshold, windowSeconds, follow });
    render();

    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [timeline, revision, threshold, windowSeconds, follow]);

  const numSpeakers = timeline?.numSpeakers ?? 8;
  return (
    <div className="timeline">
      <div className="timeline__labels" style={{ gridTemplateRows: `repeat(${numSpeakers}, minmax(0, 1fr))` }}>
        {Array.from({ length: numSpeakers }, (_, speaker) => (
          <span key={speaker} className="timeline__label" style={{ color: speakerColor(speaker) }}>
            <span className="timeline__label-word">Speaker </span>
            {speaker + 1}
          </span>
        ))}
      </div>
      <canvas ref={canvasRef} className="timeline__canvas" />
    </div>
  );
}

interface DrawOptions {
  threshold: number;
  windowSeconds: number;
  follow: boolean;
}

function draw(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  timeline: ProbabilityTimeline,
  { threshold, windowSeconds, follow }: DrawOptions,
): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  // Layout is owned by CSS so the gutter can shrink with the lane labels on narrow screens.
  const style = getComputedStyle(canvas);
  const gutter = Number.parseFloat(style.getPropertyValue("--timeline-gutter")) || 0;
  const lanesHeight = height - (Number.parseFloat(style.getPropertyValue("--timeline-axis")) || 0);

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const { numSpeakers, numFrames, frameDurationSeconds } = timeline;
  const laneHeight = (lanesHeight - LANE_GAP * (numSpeakers - 1)) / numSpeakers;
  const plotWidth = width - gutter;

  const windowFrames = Math.round(windowSeconds / frameDurationSeconds);
  const firstFrame = follow ? Math.max(0, numFrames - windowFrames) : 0;
  const visibleFrames = Math.max(1, numFrames - firstFrame);

  for (let speaker = 0; speaker < numSpeakers; speaker++) {
    const top = speaker * (laneHeight + LANE_GAP);
    context.fillStyle = LANE_BACKGROUND;
    context.beginPath();
    context.roundRect(gutter, top, plotWidth, laneHeight, 4);
    context.fill();
  }

  if (numFrames === 0) return drawAxis(context, gutter, width, height, firstFrame, visibleFrames, frameDurationSeconds);

  const probabilities = timeline.view();
  const framesPerColumn = visibleFrames / plotWidth;

  for (let column = 0; column < plotWidth; column++) {
    const start = firstFrame + Math.floor(column * framesPerColumn);
    const end = Math.min(numFrames, firstFrame + Math.ceil((column + 1) * framesPerColumn));

    for (let speaker = 0; speaker < numSpeakers; speaker++) {
      let peak = 0;
      for (let frame = start; frame < end; frame++) {
        peak = Math.max(peak, probabilities[frame * numSpeakers + speaker]);
      }
      if (peak < threshold * 0.4) continue;

      const top = speaker * (laneHeight + LANE_GAP);
      const barHeight = Math.max(2, laneHeight * Math.min(1, peak));
      context.fillStyle = speakerColorAlpha(speaker, peak >= threshold ? 0.95 : 0.25);
      context.fillRect(gutter + column, top + (laneHeight - barHeight) / 2, 1.2, barHeight);
    }
  }

  drawAxis(context, gutter, width, height, firstFrame, visibleFrames, frameDurationSeconds);
}

function drawAxis(
  context: CanvasRenderingContext2D,
  gutter: number,
  width: number,
  height: number,
  firstFrame: number,
  visibleFrames: number,
  frameDurationSeconds: number,
): void {
  const plotWidth = width - gutter;
  const ticks = plotWidth < 360 ? 3 : 6;

  context.font = AXIS_FONT;
  context.textBaseline = "bottom";
  context.fillStyle = AXIS_TEXT_COLOR;

  for (let tick = 0; tick <= ticks; tick++) {
    const x = gutter + (plotWidth * tick) / ticks;
    const seconds = (firstFrame + (visibleFrames * tick) / ticks) * frameDurationSeconds;
    context.textAlign = tick === 0 ? "left" : tick === ticks ? "right" : "center";
    context.fillText(formatTimestamp(seconds), x, height);
  }
}
