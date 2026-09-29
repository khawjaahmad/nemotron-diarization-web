import { useEffect, useRef } from "react";

import "./WaveformMeter.css";

const BAR_COUNT = 28;

export interface WaveformMeterProps {
  analyser: AnalyserNode | null;
}

/** Live input level as a row of bars, idle and flat when the microphone is closed. */
export function WaveformMeter({ analyser }: WaveformMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const samples = analyser ? new Float32Array(analyser.fftSize) : null;
    const levels = new Float32Array(BAR_COUNT);
    let frame = 0;

    const render = () => {
      frame = requestAnimationFrame(render);
      if (analyser && samples) {
        analyser.getFloatTimeDomainData(samples);
        levels.copyWithin(0, 1);
        levels[BAR_COUNT - 1] = rootMeanSquare(samples);
      } else {
        levels.fill(0);
      }
      drawBars(context, canvas, levels);
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return <canvas ref={canvasRef} className="meter" aria-hidden />;
}

function rootMeanSquare(samples: Float32Array): number {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return Math.sqrt(total / samples.length);
}

function drawBars(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, levels: Float32Array): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0) return;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const step = width / BAR_COUNT;
  for (let bar = 0; bar < BAR_COUNT; bar++) {
    const level = Math.min(1, levels[bar] * 6);
    const barHeight = Math.max(2, level * height);
    context.fillStyle = level > 0.02 ? "rgba(31, 140, 249, 0.9)" : "rgba(255, 255, 255, 0.14)";
    context.beginPath();
    context.roundRect(bar * step + 1, (height - barHeight) / 2, step - 2, barHeight, 1.5);
    context.fill();
  }
}
