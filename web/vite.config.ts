import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/** The sibling Hugging Face checkpoint, served as-is so the 100–400 MB weights are never copied. */
const CHECKPOINT_DIR = join(import.meta.dirname, "..", "Nemotron-3-Diarization-ONNX");
const MODEL_ROUTE = "/models";

const ORT_DIST = dirname(createRequire(import.meta.url).resolve("onnxruntime-web"));
const ORT_ROUTE = "/ort";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".onnx": "application/octet-stream",
  ".onnx_data": "application/octet-stream",
  ".wasm": "application/wasm",
};

/** Streams `/models/**` straight off disk during `dev` and `preview`. */
function serveCheckpoint(): Plugin {
  const handler = (request: any, response: any, next: () => void) => {
    const url = (request.url ?? "").split("?")[0];
    if (!url.startsWith(`${MODEL_ROUTE}/`)) return next();

    const relative = normalize(decodeURIComponent(url.slice(MODEL_ROUTE.length + 1)));
    if (relative.startsWith("..")) return next();

    const path = join(CHECKPOINT_DIR, relative);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      response.statusCode = 404;
      return response.end(`Not found in checkpoint: ${relative}`);
    }

    response.setHeader("Content-Type", CONTENT_TYPES[extname(path)] ?? "application/octet-stream");
    response.setHeader("Content-Length", size);
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    createReadStream(path).pipe(response);
  };

  return {
    name: "serve-checkpoint",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

/**
 * ONNX Runtime builds its WebAssembly file paths at runtime, so no bundler can follow those
 * imports. Publishing its whole `dist` under a fixed route gives `env.wasm.wasmPaths` a prefix to
 * use, and avoids having to predict which of the runtime flavours it decides to pull in.
 *
 * Rollup still emits its own copy of the `.wasm`, from a static `new URL` that is never actually
 * taken once `wasmPaths` is set; that dead 28 MB is dropped from the bundle here.
 */
function serveOrtRuntime(): Plugin {
  const handler = (request: any, response: any, next: () => void) => {
    const url = (request.url ?? "").split("?")[0];
    if (!url.startsWith(`${ORT_ROUTE}/`)) return next();

    const name = normalize(url.slice(ORT_ROUTE.length + 1));
    if (name.startsWith("..") || !existsSync(join(ORT_DIST, name))) return next();

    response.setHeader("Content-Type", CONTENT_TYPES[extname(name)] ?? "application/octet-stream");
    createReadStream(join(ORT_DIST, name)).pipe(response);
  };

  return {
    name: "serve-ort-runtime",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
    generateBundle(_options, bundle) {
      for (const [key, asset] of Object.entries(bundle)) {
        if (asset.type === "asset" && /^assets\/ort-wasm.*\.wasm$/.test(asset.fileName)) {
          delete bundle[key];
        }
      }
      for (const name of readdirSync(ORT_DIST).filter((f) => /\.(mjs|wasm)$/.test(f))) {
        const source = readFileSync(join(ORT_DIST, name));
        this.emitFile({ type: "asset", fileName: `${ORT_ROUTE.slice(1)}/${name}`, source });
      }
    },
  };
}

/** Multi-threaded ONNX Runtime WASM needs `SharedArrayBuffer`, which needs cross-origin isolation. */
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), serveCheckpoint(), serveOrtRuntime()],
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  worker: { format: "es" },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
