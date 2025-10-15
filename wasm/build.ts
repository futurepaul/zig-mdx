#!/usr/bin/env bun

/**
 * Build script for zig-mdx package
 * Compiles TypeScript and copies WASM file to dist
 */

import { existsSync } from "fs";
import { mkdir, rm, copyFile } from "fs/promises";
import { $ } from "bun";

console.log("🏗️  Building zig-mdx package...\n");

const start = performance.now();

// Clean dist directory
if (existsSync("dist")) {
  console.log("🗑️  Cleaning previous build...");
  await rm("dist", { recursive: true, force: true });
}

await mkdir("dist", { recursive: true });

// Compile TypeScript with tsc for type declarations
console.log("📝 Generating TypeScript declarations...");
await $`bun x tsc`;

// Bundle with Bun
console.log("📦 Bundling with Bun...");
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "browser",
  format: "esm",
  splitting: false,
  minify: false,
  sourcemap: "external",
});

if (!result.success) {
  console.error("❌ Build failed:");
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

// Copy WASM file to dist
console.log("📋 Copying WASM file...");
const wasmSource = "../zig-out/bin/zigmdx.wasm";
const wasmDest = "./dist/mdx.wasm";

if (existsSync(wasmSource)) {
  await copyFile(wasmSource, wasmDest);
  console.log("✅ WASM file copied");
} else {
  console.warn("⚠️  Warning: zigmdx.wasm not found in ../zig-out/bin/");
  console.warn("   Run 'zig build' from the root directory first");
}

const end = performance.now();
const buildTime = (end - start).toFixed(2);

console.log(`\n✅ Build completed in ${buildTime}ms`);
console.log("\n📊 Output:");
console.log("   dist/index.js");
console.log("   dist/index.d.ts");
console.log("   dist/types.d.ts");
console.log("   dist/mdx.wasm");
