# zig-mdx

Blazing fast MDX parser for the web, powered by Zig and WebAssembly.

## Installation

```bash
npm install zig-mdx
# or
bun add zig-mdx
```

## Usage

```typescript
import { parse } from 'zig-mdx';

const mdx = `
# Hello World

This is **MDX** with {dynamic} expressions!

<CustomComponent prop="value" />
`;

const ast = await parse(mdx);

// The AST is a nested tree structure
console.log(ast.type); // "root"
console.log(ast.children[0].type); // "heading"
console.log(ast.children[0].level); // 1

// Traverse the tree recursively
function traverse(node) {
  console.log(node.type);
  if ('children' in node) {
    node.children.forEach(traverse);
  }
}
traverse(ast);
```

## Features

- ⚡️ **Blazing Fast**: Written in Zig, compiled to WebAssembly
- 📦 **Tiny Bundle**: ~32KB WASM binary
- 🌳 **Full AST**: Complete Abstract Syntax Tree with all node types
- 🎯 **Type Safe**: Full TypeScript support with detailed types
- 🔧 **Zero Dependencies**: No runtime dependencies
- 🔄 **Auto-initializing**: WASM loads automatically on first parse

## API

### `parse(source: string): Promise<AST>`

Parses an MDX string and returns a nested tree structure representing the Abstract Syntax Tree.

The WASM module is initialized automatically on first call, so you can just start parsing immediately.

**Parameters:**
- `source`: The MDX source code to parse

**Returns:**
- A Promise resolving to an `AST` object with a nested tree structure

**Example:**
```typescript
const ast = await parse('# Hello World');
console.log(ast.children[0].type); // "heading"
```

### `init(customWasmPath?: string): Promise<void>`

Manually initialize the WASM module. This is optional - `parse()` calls it automatically.

Use this to:
- **Pre-warm** the parser to avoid first-parse latency
- **Custom WASM paths** for different bundler configurations

**Parameters:**
- `customWasmPath` (optional): Custom path to the WASM file

**Example:**
```typescript
// Pre-initialize for faster first parse
await init();

// Or with custom WASM path for specific bundler setups
await init('/public/mdx.wasm');
```

### `reset(): Promise<void>`

Frees all allocated WASM memory. Useful for long-running processes that parse many files.

Call this periodically if you're parsing thousands of files to prevent memory buildup.

**Example:**
```typescript
for (const file of largeFileSet) {
  const ast = await parse(file.content);
  processAst(ast);
}
// Free accumulated memory
await reset();
```

### `getVersion(): Promise<number>`

Returns the version number of the WASM module.

**Returns:**
- A Promise resolving to the version number

**Example:**
```typescript
const version = await getVersion();
console.log(`WASM module version: ${version}`);
```

### AST Structure

The parser returns a nested tree structure that's easy to traverse and consume:

```typescript
interface AST {
  type: "root";
  children: Node[];
  source: string;       // Original source code
  errors: ParseError[]; // Parse errors (if any)
}

// Example output
{
  "type": "root",
  "children": [
    {
      "type": "heading",
      "level": 1,
      "children": [
        { "type": "text", "value": "Hello World" }
      ]
    },
    {
      "type": "paragraph",
      "children": [
        { "type": "text", "value": "A paragraph with " },
        {
          "type": "strong",
          "children": [
            { "type": "text", "value": "bold" }
          ]
        },
        { "type": "text", "value": " text." }
      ]
    }
  ],
  "source": "# Hello World\n\nA paragraph with **bold** text.",
  "errors": []
}
```

### Node Types

All node types with their properties:

```typescript
// Container nodes with children
type ParagraphNode = { type: "paragraph", children: Node[] }
type HeadingNode = { type: "heading", level: number, children: Node[] }
type BlockquoteNode = { type: "blockquote", children: Node[] }
type ListNode = { type: "list_unordered" | "list_ordered", children: Node[] }
type ListItemNode = { type: "list_item", children: Node[] }
type EmphasisNode = { type: "emphasis", children: Node[] }
type StrongNode = { type: "strong", children: Node[] }

// Leaf nodes with values
type TextNode = { type: "text", value: string }
type CodeBlockNode = { type: "code_block", lang?: string, value: string }
type InlineCodeNode = { type: "code_inline", value: string }
type FrontmatterNode = { type: "frontmatter", value: string }
type MdxExpressionNode = {
  type: "mdx_text_expression" | "mdx_flow_expression",
  value: string
}

// Link and image nodes
type LinkNode = { type: "link", url: string, children: Node[] }
type ImageNode = { type: "image", url: string, children: Node[] }

// JSX nodes
type JsxElementNode = {
  type: "mdx_jsx_element",
  name: string,
  attributes: JsxAttribute[],
  children: Node[]
}
type JsxSelfClosingNode = {
  type: "mdx_jsx_self_closing",
  name: string,
  attributes: JsxAttribute[]
}
type JsxFragmentNode = { type: "mdx_jsx_fragment", children: Node[] }

// Other
type ThematicBreakNode = { type: "hr" }
```

## Supported MDX Features

- ✅ Headings (`#`, `##`, `###`, etc.)
- ✅ Paragraphs and line breaks
- ✅ Emphasis and strong emphasis (`*`, `**`, `_`, `__`)
- ✅ Links and images (`[text](url)`, `![alt](url)`)
- ✅ Lists (ordered and unordered)
- ✅ Blockquotes (`>`)
- ✅ Code blocks (fenced with ` ``` `)
- ✅ Inline code (`` `code` ``)
- ✅ JSX elements (`<Component />`, `<Component>children</Component>`)
- ✅ JSX fragments (`<>...</>`)
- ✅ JSX attributes with expressions
- ✅ MDX expressions (`{expression}`)
- ✅ YAML frontmatter (`---`)
- ✅ Horizontal rules (`---`, `***`, `___`)
- ✅ ESM imports and exports

## Performance

Built with Zig and compiled to WebAssembly for maximum performance. The parser is designed for:

- **Fast parsing**: Zero-copy tokenization with efficient memory management
- **Small bundle size**: Only ~32KB WASM binary (+ ~3KB JavaScript wrapper)
- **Memory efficient**: Proper cleanup with `reset()` for long-running processes
- **Browser-ready**: Works in all modern browsers and Node.js 18+

## License

MIT

## Credits

Powered by [Zig](https://ziglang.org/) - A general-purpose programming language designed for robustness, optimality, and clarity.
