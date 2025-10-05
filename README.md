# zig-mdx

An MDX (Markdown with JSX) tokenizer and parser written in Zig.

## Features

- Full MDX support (expressions, JSX, ESM imports/exports)
- YAML frontmatter parsing
- Efficient AST representation using Zig compiler patterns
- Zero-copy tokenization
- Comprehensive error reporting and recovery

## Architecture

Based on Zig's compiler design:

1. **Tokenization**: Multi-mode state machine (Markdown/JSX/Expression)
2. **Parsing**: Recursive descent with error accumulation
3. **AST**: Cache-efficient MultiArrayList storage with extra_data for variable-sized nodes

See `research/` for detailed architectural documentation.

## Building

```bash
nix develop  # Enter dev environment with Zig 0.15
zig build    # Build library
zig build test  # Run tests
```

## Usage

```zig
const mdx = @import("zig-mdx");

const source =
    \\---
    \\title: Hello World
    \\---
    \\# {frontmatter.title}
    \\
    \\<Component prop={value}>
    \\  Content here
    \\</Component>
;

const ast = try mdx.parse(allocator, source);
defer ast.deinit(allocator);

// Traverse AST
for (ast.children(0)) |child| {
    // Process nodes...
}
```

## Project Structure

```
src/
  lib.zig         - Public API
  Token.zig       - Token definitions
  Tokenizer.zig   - Tokenization state machine
  Ast.zig         - AST structure and node types
  Parser.zig      - Parsing implementation
research/
  ZIG_PARSER_ARCHITECTURE_RESEARCH.md - Deep dive into Zig compiler patterns
  ADVANCED_PATTERNS.md - Expert-level parser techniques
  QUICK_REFERENCE.md - Quick lookup guide
```

## Status

🚧 **Under active development** - Week 1: Tokenizer implementation

## License

MIT
