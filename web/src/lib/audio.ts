/**
 * AudioWorklet that forwards microphone samples to the main thread in fixed-size blocks.
 * Inlined as a blob so it needs no separate build entry.
 */
const CAPTURE_PROCESSOR = /* js */ `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.blockSize = processorOptions.blockSize;
    this.block = new Float32Array(this.blockSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.block[this.filled++] = channel[i];
      if (this.filled < this.blockSize) continue;
      this.port.postMessage(this.block.slice());
      this.filled = 0;
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

export interface MicrophoneCapture {
  analyser: AnalyserNode;
  stop: () => Promise<void>;
}

/**
 * Opens the microphone and streams mono blocks at `sampleRate`. The `AudioContext` is created at
 * the target rate so the browser's own resampler does the conversion.
 */
export async function captureMicrophone(
  sampleRate: number,
  blockSize: number,
  onBlock: (samples: Float32Array) => void,
): Promise<MicrophoneCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const context = new AudioContext({ sampleRate });
  const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_PROCESSOR], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.7;

  const capture = new AudioWorkletNode(context, "capture-processor", { processorOptions: { blockSize } });
  capture.port.onmessage = ({ data }: MessageEvent<Float32Array>) => onBlock(data);
  source.connect(analyser).connect(capture);

  return {
    analyser,
    stop: async () => {
      capture.port.onmessage = null;
      capture.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close();
    },
  };
}

/** Decodes any browser-supported audio file into mono samples at `sampleRate`. */
export async function decodeAudioFile(file: File, sampleRate: number): Promise<Float32Array> {
  const encoded = await file.arrayBuffer();
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });
  const decoded = await context.decodeAudioData(encoded);
  return downmix(decoded);
}

function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += samples[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)}s` : formatTimestamp(seconds);
}
