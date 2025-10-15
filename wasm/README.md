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
- 📦 **Tiny Bundle**: < 50KB WASM binary
- 🌳 **Full AST**: Complete Abstract Syntax Tree with all node types
- 🎯 **Type Safe**: Full TypeScript support with detailed types
- 🔧 **Zero Dependencies**: No runtime dependencies

## API

### `parse(source: string): Promise<AST>`

Parses an MDX string and returns a nested tree structure representing the Abstract Syntax Tree.

**Parameters:**
- `source`: The MDX source code to parse

**Returns:**
- A Promise resolving to an `AST` object with a nested tree structure

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
