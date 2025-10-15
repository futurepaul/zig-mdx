/**
 * zig-mdx - Blazing fast MDX parser powered by Zig and WebAssembly
 */

import type { WasmExports, AST } from "./types";

// WASM module cache
let wasmModule: WebAssembly.Module | null = null;
let wasmInstance: WebAssembly.Instance | null = null;
let wasmExports: WasmExports | null = null;

/**
 * Initialize the WASM module
 * This is called automatically on first parse, but can be called manually for faster first parse
 *
 * @param customWasmPath - Optional custom path to the WASM file (useful for browser environments)
 */
export async function init(customWasmPath?: string): Promise<void> {
  if (wasmInstance !== null) {
    return; // Already initialized
  }

  // Load WASM file - use custom path if provided, otherwise use default
  const wasmPath = customWasmPath
    ? customWasmPath
    : new URL("./mdx.wasm", import.meta.url).toString();

  // Fetch and instantiate
  const wasmBuffer = await fetch(wasmPath).then((r) => r.arrayBuffer());
  wasmModule = await WebAssembly.compile(wasmBuffer);
  wasmInstance = await WebAssembly.instantiate(wasmModule, {});

  wasmExports = wasmInstance.exports as unknown as WasmExports;

  // Initialize WASM module
  wasmExports.wasm_init();
}

/**
 * Parse MDX source code and return AST
 *
 * @param source - The MDX source code to parse
 * @returns AST object containing nodes, tokens, errors, and source
 *
 * @example
 * ```typescript
 * const ast = await parse('# Hello World');
 * console.log(ast.nodes);
 * ```
 */
export async function parse(source: string): Promise<AST> {
  // Ensure WASM is initialized
  if (wasmExports === null) {
    await init();
  }

  if (!wasmExports) {
    throw new Error("Failed to initialize WASM module");
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Encode source to UTF-8
  const sourceBytes = encoder.encode(source);

  // Allocate memory for source (handle empty string case)
  const allocSize = sourceBytes.length || 1; // Allocate at least 1 byte
  const sourcePtr = wasmExports.wasm_alloc(allocSize);
  if (sourcePtr === 0) {
    throw new Error("Failed to allocate memory for source");
  }

  try {
    // Copy source to WASM memory (only if non-empty)
    if (sourceBytes.length > 0) {
      const memory = new Uint8Array(wasmExports.memory.buffer);
      memory.set(sourceBytes, sourcePtr);
    }

    // Allocate memory for output pointers
    const outJsonPtrPtr = wasmExports.wasm_alloc(4); // pointer to pointer
    const outJsonLenPtr = wasmExports.wasm_alloc(4); // pointer to length

    if (outJsonPtrPtr === 0 || outJsonLenPtr === 0) {
      throw new Error("Failed to allocate memory for output pointers");
    }

    try {
      // Call parse function
      const success = wasmExports.wasm_parse_mdx(
        sourcePtr,
        sourceBytes.length,
        outJsonPtrPtr,
        outJsonLenPtr
      );

      if (!success) {
        throw new Error("Failed to parse MDX");
      }

      // Read output pointer and length
      const memoryView = new DataView(wasmExports.memory.buffer);
      const jsonPtr = memoryView.getUint32(outJsonPtrPtr, true);
      const jsonLen = memoryView.getUint32(outJsonLenPtr, true);

      // Read JSON string from WASM memory
      const jsonBytes = new Uint8Array(wasmExports.memory.buffer, jsonPtr, jsonLen);
      const jsonStr = decoder.decode(jsonBytes);

      // Parse JSON
      const ast: AST = JSON.parse(jsonStr);

      // Free JSON memory
      wasmExports.wasm_free(jsonPtr, jsonLen);

      return ast;
    } finally {
      // Free output pointer memory
      wasmExports.wasm_free(outJsonPtrPtr, 4);
      wasmExports.wasm_free(outJsonLenPtr, 4);
    }
  } finally {
    // Free source memory
    wasmExports.wasm_free(sourcePtr, sourceBytes.length);
  }
}

/**
 * Reset the WASM allocator (frees all allocated memory)
 * Useful for long-running processes that parse many files
 */
export async function reset(): Promise<void> {
  if (wasmExports === null) {
    return;
  }
  wasmExports.wasm_reset();
}

/**
 * Get the version of the WASM module
 */
export async function getVersion(): Promise<number> {
  if (wasmExports === null) {
    await init();
  }
  if (!wasmExports) {
    throw new Error("Failed to initialize WASM module");
  }
  return wasmExports.wasm_get_version();
}

// Re-export types
export type { AST, Node, ParseError, JsxAttribute } from "./types";
