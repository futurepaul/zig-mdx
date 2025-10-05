# MDX Parser Fixes

## Summary

The MDX tokenizer and parser are now functional and can successfully parse both simple and complex MDX documents including:
- Markdown syntax (headings, paragraphs, bold, italic)
- MDX expressions (`{state.variable}`)
- JSX elements (`<Component />`, `<Parent><Child /></Parent>`)
- Frontmatter (YAML between `---` delimiters)

## Issues Fixed

### 1. **Missing `strong_end` and `emphasis_end` tokens**
**Problem:** The tokenizer only generated `strong_start` and `emphasis_start` tokens but never generated the corresponding `_end` tokens. This caused the parser to create reserved nodes that were never finalized, leading to corrupt AST structure.

**Solution:** Added depth tracking (`strong_depth`, `emphasis_depth`) to the tokenizer. The `maybe_strong_or_emphasis` state now checks the depth to determine whether to generate a `_start` or `_end` token.

**Changed files:**
- `src/Tokenizer.zig` - Added depth tracking fields and logic

### 2. **Use-after-free bug in Parser.deinit**
**Problem:** The `parse()` function moved `parser.nodes` into the returned AST, but then `defer parser.deinit()` tried to call `nodes.deinit()` on the already-moved value, causing a segmentation fault.

**Solution:** Created a new `deinitExceptNodes()` function that doesn't free the nodes MultiArrayList since it's been moved to the AST.

**Changed files:**
- `src/Parser.zig` - Added `deinitExceptNodes()` function

### 3. **Emphasis/strong at line start treated as HR/list**
**Problem:** When `**bold**` or `*italic*` appeared at the start of a line, the tokenizer went into the `hr_or_frontmatter` state (checking for horizontal rules, frontmatter, or list items). When it wasn't any of those, it fell through to the `text` state with the `start` position pointing to the first `*`, causing the entire `**bold` to be tokenized as a single text token.

**Solution:** In the `hr_or_frontmatter` state, when we determine it's not HR/frontmatter/list and the character is `*`, reset the index and transition to `maybe_strong_or_emphasis` state instead of `text`.

**Changed files:**
- `src/Tokenizer.zig` - Special case handling for `*` in `hr_or_frontmatter` state

### 4. **Exclamation mark (`!`) causing infinite loop**
**Problem:** When the tokenizer encountered a standalone `!` (not followed by `[` for images), it set `state = .text` without advancing the index. The `.text` state immediately returned because `!` is in the break list, creating a zero-length token and causing an infinite loop.

**Solution:** When `!` is not followed by `[`, consume the `!` character before transitioning to `.text` state.

**Changed files:**
- `src/Tokenizer.zig` - Consume `!` before transitioning to text state

### 5. **Document tree printing from wrong root**
**Problem:** The tree printing started from node 0, but the document node is actually the last node created (due to bottom-up parsing).

**Solution:** Print tree starting from `nodes.len - 1` instead of 0.

**Changed files:**
- `src/main.zig` - Fixed root node index calculation

## Test Results

### test.hnmd (Simple test)
```
# Hello World

This is a test.

This has **bold text** in it.

And *italic* too.
```

✅ Parses successfully with correct AST structure

### hello.hnmd (Complex test ~1KB)
- Frontmatter with YAML
- Headings with expressions
- Bold and italic text
- MDX text expressions
- JSX elements (hstack, vstack, button, input)
- Images with markdown syntax
- Horizontal rules

✅ Parses successfully (48 nodes, 196 tokens)

### feed.hnmd (JSX-heavy test)
- Frontmatter with nested YAML
- Headings with expressions
- JSX elements with attributes
- Nested JSX components

✅ Parses successfully (15 nodes, 89 tokens)

## Known Limitations

The parser still has some areas that could be improved:
1. Some empty paragraph nodes are created unnecessarily
2. JSX child content parsing could be more sophisticated
3. Link and image parsing could be more robust
4. Code fence end token generation needs implementation

However, the core tokenizer and parser are now functional and correctly handle the most common MDX patterns found in the test files.
