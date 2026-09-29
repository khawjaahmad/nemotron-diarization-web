# Nemotron 3 Diarization for the Web

Streaming speaker diarization that runs entirely in the browser. No server, no API key, no audio
leaving the device.

**Live demo:** [huggingface.co/spaces/ahmadw/nemotron-diarization-web](https://huggingface.co/spaces/ahmadw/nemotron-diarization-web)

This is a TypeScript port of the inference pipeline around
[NVIDIA Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization), using the
ONNX export from
[onnx-community/Nemotron-3-Diarization-ONNX](https://huggingface.co/onnx-community/Nemotron-3-Diarization-ONNX)
with ONNX Runtime Web on WebGPU or WASM.

The exported graph covers only the neural network. The log-mel front end, the Arrival-Order Speaker
Cache and the FIFO queue that keep speaker identities stable across chunks are reimplemented here in
TypeScript, and verified frame-for-frame against a Python reference implementation.

## Features

- Up to **8 simultaneous speakers**, including overlapping speech
- **10 ms** output resolution
- Input buffer latency from **320 ms**, plus a 30.4 s offline mode
- Live microphone or audio file input
- Runs off the main thread in a Web Worker
- Responsive dark UI, from phones to wide desktops

## Backend support

Only the fp32 graph is usable on WebGPU. Every quantized variant in the ONNX export contains
`MatMulNBits` nodes at **8 bits**, and ONNX Runtime's WebGPU kernel accepts only 2-bit and 4-bit,
so the session fails to build:

> `Only 2b and 4b quantization is supported for MatMulNBits op, additional bits support is planned.`

This applies to `model_q4` and `model_q4f16` too, despite their names — they are mixed, with 93 of
127 matmuls at 4 bits and the remaining 34 still at 8 bits.

| Variant | Size | WASM | WebGPU |
| --- | --- | --- | --- |
| `model` (fp32) | 398 MB | yes | **yes** |
| `model_fp16` | 200 MB | yes | builds, but output is wrong |
| `model_quantized` (int8) | 121 MB | yes | fails to build |
| `model_q4` | 83 MB | yes | fails to build |
| `model_q4f16` | 73 MB | yes | fails to build |

`model_fp16` is a trap on WebGPU. It builds and runs, but disagrees with fp32 on the dominant
speaker for **31% of frames** and flips 9.3% of threshold decisions. The weights are fine — the same
graph on WASM matches fp32 to within 0.0022 — so the error is in ONNX Runtime's WebGPU fp16 kernels.
The app therefore offers fp32 only when WebGPU is selected.

## Accuracy and speed on WASM

Measured by [`tools/compare_variants.py`](tools/compare_variants.py) over a 30 s excerpt, each
variant against the fp32 baseline:

| Variant | Size | Time | RTFx | Max error | Mean error |
| --- | --- | --- | --- | --- | --- |
| `model` | 398 MB | 2.2 s | 13.7 | — | — |
| `model_fp16` | 200 MB | 2.1 s | 14.2 | 0.0022 | 0.0000 |
| `model_quantized` | 121 MB | 2.1 s | 14.1 | 0.0123 | 0.0001 |
| `model_q4` | 83 MB | 2.9 s | 10.2 | 0.0976 | 0.0006 |
| `model_q4f16` | 73 MB | 3.8 s | 7.9 | 0.0981 | 0.0006 |

## Quick start

```bash
# 1. Fetch the ONNX checkpoint (~835 MB) next to the app
hf download onnx-community/Nemotron-3-Diarization-ONNX \
  --local-dir Nemotron-3-Diarization-ONNX

# 2. Run the app
cd web
npm install
npm run dev
```

Then open http://localhost:5173.

`vite.config.ts` streams `/models/**` straight off disk from the checkpoint directory, so the
weights are never copied into the bundle. To load them from Hugging Face instead, set
`VITE_MODEL_BASE_URL` (see [`.env.example`](.env.example)).

## Building and deploying

```bash
cd web
npm run build      # type-checks, then writes a static site to web/dist
npm run preview    # serves the build locally
```

Production builds read [`web/.env.production`](web/.env.production), which points
`VITE_MODEL_BASE_URL` at the Hugging Face CDN, so `dist/` contains only the app and the ONNX Runtime
WebAssembly (about 29 MB). Browsers download the weights on first use and cache them.

`dist/` is a plain static site and runs on any static host. The live demo is a static Hugging Face
Space:

```bash
hf upload <user>/<space> web/dist . --repo-type space --delete "assets/*"
```

`--delete "assets/*"` removes the previous build's hashed bundles.

## How it works

Audio is captured at 16 kHz by an `AudioWorklet`, forwarded in 128 ms blocks to a worker, and
buffered there until a full chunk plus its look-ahead is available. Each chunk is turned into a
log-mel spectrogram, concatenated with the speaker cache, and pushed through the ONNX graph.

```
web/src/
├── App.tsx                   Layout and wiring between hooks and components
├── components/               Top bar, speaker tiles, activity timeline, turn list, control bar
├── styles/theme.css          Colour, radius, shadow and font tokens
├── worker/
│   ├── diarizer.worker.ts    Owns the ONNX session; serialises inference
│   └── protocol.ts           Typed messages between page and worker
├── lib/
│   ├── diarizer.ts           Chunking, look-ahead, streaming state machine
│   ├── featureExtractor.ts   Pre-emphasis, STFT, log-mel — port of the NeMo extractor
│   ├── fft.ts, mel.ts        Radix-2 FFT and mel filter bank
│   ├── speakerCache.ts       Arrival-Order Speaker Cache and FIFO queue
│   ├── segments.ts           Probabilities to speaker turns
│   ├── timeline.ts           Growing probability buffer for the UI
│   ├── speakerStyle.ts       Speaker colours and labels
│   └── audio.ts              Microphone capture and file decoding
└── hooks/
    ├── useDiarizer.ts        Worker lifecycle, session tagging
    └── useMicrophone.ts      Capture lifecycle
```

Two details that are easy to get wrong:

**Window centring.** The first chunk of a session uses centred STFT windows; every later chunk must
use uncentred ones, so that streaming frames reproduce those of a single full pass.

**Thread count.** `ort.env.wasm.numThreads` is pinned to 1. ONNX Runtime's pthreads would be nested
workers, whose script fetches the browser routes through the parent worker's event loop — which
Emscripten blocks while waiting for the pool, deadlocking the session build.

## Testing

```bash
cd web
npm test
```

The suite checks the TypeScript port against golden tensors dumped from the Python reference by
[`tools/make_fixtures.py`](tools/make_fixtures.py): the mel filter bank, the STFT window, centred and
uncentred spectrograms, and end-to-end probabilities. It also asserts that feeding audio in small
blocks gives bit-identical results to feeding it in large ones.

Fixtures are committed, so the tests run without the checkpoint.

## Tools

The Python reference in [`tools/`](tools) needs the checkpoint, plus `onnxruntime`, `librosa` and
`numpy`. It reads its audio from `.scratch/diarization_example.mp3`, which is not redistributed
here — point the scripts at any 16 kHz conversation.

| Script | Purpose |
| --- | --- |
| `reference.py` | NumPy implementation of the full pipeline |
| `compare_variants.py` | Benchmarks each ONNX variant against fp32 |
| `make_fixtures.py` | Regenerates the golden tensors used by the TypeScript tests |
| `validate_features.py` | Checks the mel front end against librosa |

## Requirements

A browser with WebGPU for the fast path; any browser with WASM otherwise. Chrome 113+, Edge 113+, or
Safari 26+.

## License

The code in this repository is MIT licensed. The model weights are governed by the
[OpenMDW 1.1](https://huggingface.co/nvidia/Nemotron-3-Diarization) license set by NVIDIA and are not
redistributed here.

## Acknowledgements

- NVIDIA, for [Nemotron 3 Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization) and the
  Streaming Sortformer work it builds on
- [onnx-community](https://huggingface.co/onnx-community) for the ONNX export
- The ONNX Runtime Web team
