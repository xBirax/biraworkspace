#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "dist/main/index.js")],
  outfile: path.join(root, "dist/main/index.bundle.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
});

// Leitura da agenda numa worker thread (calendar-worker.ts): arquivo próprio,
// fora do asar (asarUnpack no package.json) para o worker_threads carregar.
await build({
  entryPoints: [path.join(root, "dist/main/calendar-worker.js")],
  outfile: path.join(root, "dist/main/calendar-worker.bundle.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "none",
});

console.log("bundled desktop main process");
