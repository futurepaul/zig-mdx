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

const ast = parse(mdx);
console.log(ast);
```

## Features

- ⚡️ **Blazing Fast**: Written in Zig, compiled to WebAssembly
- 📦 **Tiny Bundle**: < 50KB WASM binary
- 🌳 **Full AST**: Complete Abstract Syntax Tree with all node types
- 🎯 **Type Safe**: Full TypeScript support with detailed types
- 🔧 **Zero Dependencies**: No runtime dependencies

## API

### `parse(source: string): AST`

Parses an MDX string and returns the Abstract Syntax Tree.

**Parameters:**
- `source`: The MDX source code to parse

**Returns:**
- An `AST` object containing nodes, tokens, errors, and the source

### AST Structure

```typescript
interface AST {
  nodes: Node[];
  tokens: Token[];
  errors: ParseError[];
  source: string;
}

interface Node {
  index: number;
  type: string;
  mainToken: number;
  // Additional properties depending on node type
  children?: number[];
  level?: number;        // For headings
  text?: string;         // For text nodes
  name?: string;         // For JSX elements
  url?: string;          // For links/images
  // ... and more
}
```

## Supported MDX Features

- ✅ Headings (ATX style `#` and Setext style)
- ✅ Paragraphs and line breaks
- ✅ Emphasis and strong emphasis (`*` and `_`)
- ✅ Links and images
- ✅ Lists (ordered and unordered)
- ✅ Blockquotes
- ✅ Code blocks (fenced and indented)
- ✅ Inline code
- ✅ JSX elements (`<Component />`)
- ✅ JSX expressions (`{expression}`)
- ✅ YAML frontmatter
- ✅ Horizontal rules
- ✅ HTML blocks
- ✅ Tables (GFM)
- ✅ Strikethrough (GFM)
- ✅ Task lists (GFM)

## Performance

Built with Zig and compiled to WebAssembly for maximum performance. Typical parsing times:

- Small files (< 1KB): < 1ms
- Medium files (10KB): < 5ms
- Large files (100KB): < 50ms

## License

MIT

## Credits

Powered by [Zig](https://ziglang.org/) - A general-purpose programming language designed for robustness, optimality, and clarity.
