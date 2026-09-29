/** Growable store of per-frame speaker probabilities for a session. */
export class ProbabilityTimeline {
  private buffer: Float32Array;
  private frames = 0;

  constructor(
    readonly numSpeakers: number,
    readonly frameDurationSeconds: number,
    initialFrames = 1 << 14,
  ) {
    this.buffer = new Float32Array(initialFrames * numSpeakers);
  }

  get numFrames(): number {
    return this.frames;
  }

  get durationSeconds(): number {
    return this.frames * this.frameDurationSeconds;
  }

  append(probabilities: Float32Array, numFrames: number): void {
    this.reserve(this.frames + numFrames);
    this.buffer.set(probabilities.subarray(0, numFrames * this.numSpeakers), this.frames * this.numSpeakers);
    this.frames += numFrames;
  }

  /** A view of every frame written so far. Valid until the next `append`. */
  view(): Float32Array {
    return this.buffer.subarray(0, this.frames * this.numSpeakers);
  }

  /** Mean probability per speaker over the last `numFrames` frames, for live level meters. */
  recentLevels(numFrames: number): Float32Array {
    const levels = new Float32Array(this.numSpeakers);
    const start = Math.max(0, this.frames - numFrames);
    const count = this.frames - start;
    if (count === 0) return levels;

    for (let frame = start; frame < this.frames; frame++) {
      for (let speaker = 0; speaker < this.numSpeakers; speaker++) {
        levels[speaker] += this.buffer[frame * this.numSpeakers + speaker];
      }
    }
    for (let speaker = 0; speaker < this.numSpeakers; speaker++) levels[speaker] /= count;
    return levels;
  }

  clear(): void {
    this.frames = 0;
  }

  private reserve(numFrames: number): void {
    if (numFrames * this.numSpeakers <= this.buffer.length) return;

    let capacity = this.buffer.length;
    while (capacity < numFrames * this.numSpeakers) capacity *= 2;
    const grown = new Float32Array(capacity);
    grown.set(this.buffer);
    this.buffer = grown;
  }
}
