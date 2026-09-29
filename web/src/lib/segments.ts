export interface Segment {
  speaker: number;
  start: number;
  end: number;
}

export interface SegmentOptions {
  threshold?: number;
  frameDurationSeconds?: number;
  /** Segments shorter than this are dropped, smoothing single-frame flicker. */
  minDurationSeconds?: number;
}

/**
 * Turns per-frame speaker probabilities into speech segments sorted by start time. Speakers are
 * numbered by first arrival, and overlapping speech yields overlapping segments.
 */
export function extractSegments(
  probabilities: Float32Array,
  numSpeakers: number,
  { threshold = 0.5, frameDurationSeconds = 0.01, minDurationSeconds = 0 }: SegmentOptions = {},
): Segment[] {
  const numFrames = probabilities.length / numSpeakers;
  const segments: Segment[] = [];

  for (let speaker = 0; speaker < numSpeakers; speaker++) {
    let start = -1;
    for (let frame = 0; frame <= numFrames; frame++) {
      const isActive = frame < numFrames && probabilities[frame * numSpeakers + speaker] > threshold;
      if (isActive && start < 0) start = frame;
      if (isActive || start < 0) continue;

      segments.push({ speaker, start: start * frameDurationSeconds, end: frame * frameDurationSeconds });
      start = -1;
    }
  }

  return segments
    .filter((segment) => segment.end - segment.start >= minDurationSeconds)
    .sort((left, right) => left.start - right.start || left.speaker - right.speaker);
}

/** Total speaking time per speaker, overlaps counted for every speaker involved. */
export function speakingTimes(segments: Segment[], numSpeakers: number): Float64Array {
  const totals = new Float64Array(numSpeakers);
  for (const segment of segments) totals[segment.speaker] += segment.end - segment.start;
  return totals;
}

/** Speakers that have spoken at least once, in order of first arrival. */
export function activeSpeakers(segments: Segment[], numSpeakers: number): number[] {
  const seen = new Set(segments.map((segment) => segment.speaker));
  return Array.from({ length: numSpeakers }, (_, speaker) => speaker).filter((speaker) => seen.has(speaker));
}
