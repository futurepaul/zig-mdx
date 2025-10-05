# UH OH - Parser Issues 🐛

## The Problems

### Problem 1: Everything Parsed as "strong"
Running `./zig-out/bin/mdx-parse test.hnmd` outputs:
```
=== NODES ===
[0] strong
[1] strong
[2] strong
[3] strong
[4] strong
```

For a simple file like:
```markdown
# Hello World

This is a test.
```

### Problem 2: Hangs on Real Files
Running with `hello.hnmd` or `feed.hnmd` causes infinite loop/hang with no output.

---

## Root Cause Analysis

### Issue 1: Tokenizer Not Detecting Start of Line

**The Problem:**
The tokenizer initializes with `line_start = 0` and sets `mode = .markdown`, but the state machine logic for detecting start-of-line vs. mid-line is broken.

Looking at `Tokenizer.zig:52-56`:
```zig
pub fn nextMarkdown(self: *Tokenizer) Token {
    const start = self.index;

    // ...

    var state: State = if (self.index == self.line_start) .start_of_line else .start;
```

**The Bug:**
- After the first newline, `line_start` gets updated to the next position
- But the logic for what constitutes "start of line" isn't working correctly
- Characters like `#` need to be at the start of a line to be headings
- Instead, they're being treated as mid-text characters

**Evidence:**
When parsing `# Hello World\n`, the `#` should trigger `.heading_start` token, but it's not being recognized as start-of-line context.

### Issue 2: Strong/Emphasis Detection Is Too Greedy

**The Problem:**
In `nextMarkdown()` at line 129:
```zig
'*' => {
    state = .maybe_strong_or_emphasis;
    self.index += 1;
},
```

**The Bug:**
This happens in ANY context (not just at word boundaries), so:
- `*` anywhere triggers emphasis/strong detection
- The tokenizer might be creating tons of `emphasis_start` or `strong_start` tokens
- The parser then creates corresponding AST nodes
- Since everything starts with `*` tokens, everything becomes `strong` nodes

**Why "strong" specifically?**
Looking at `maybe_strong_or_emphasis` state (line 178):
```zig
.maybe_strong_or_emphasis => {
    if (self.buffer[self.index] == '*') {
        self.index += 1;
        return self.makeToken(.strong_start, start);
    } else {
        return self.makeToken(.emphasis_start, start);
    }
}
```

If the tokenizer sees any character that isn't `*`, it returns `.emphasis_start`, but the AST might be defaulting everything to `.strong` due to parser logic.

### Issue 3: Infinite Loop in Parser or CLI

**The Problem:**
The CLI hangs when processing larger files like `hello.hnmd`.

**Potential Causes:**

1. **Parser Infinite Loop:**
   - `parseDocument()` has `while (p.token_tags[p.token_index] != .eof)`
   - If `token_index` never advances, infinite loop
   - Error recovery `findNextBlock()` might not be advancing properly
   - Some parse function might be stuck re-parsing the same tokens

2. **CLI Infinite Recursion:**
   - `printNode()` recursively prints children
   - If there's a cycle in the AST (child pointing back to parent), infinite recursion
   - `ast.children()` might be returning wrong data causing re-visiting same nodes

3. **Tokenizer Infinite Loop:**
   - Some state in the tokenizer never advances `self.index`
   - Stuck in a loop creating the same token forever
   - The `while (true)` loop in `nextMarkdown()` has exit conditions, but maybe one is missed

**Evidence:**
- Simple test file hangs
- Larger files hang
- No output before hanging (suggests issue in parsing phase, not just printing)

### Issue 4: Document Node Not Being Created

**The Problem:**
Looking at the output, there's no `document` node at index 0 - just `strong` nodes.

**Root Cause:**
`parseDocument()` in Parser.zig does create a document node, but something is wrong with how nodes are being added to the AST.

Possible issues:
1. Parser state is getting corrupted
2. Nodes are being overwritten in the MultiArrayList
3. The `reserveNode()` / `setNode()` pattern is buggy
4. `addNode()` is appending when it should be inserting at index 0

---

## Potential Solutions

### Solution 1: Fix Tokenizer Start-of-Line Detection

**Current broken logic:**
```zig
var state: State = if (self.index == self.line_start) .start_of_line else .start;
```

**Issues:**
- After consuming tokens, `self.index` advances but `line_start` doesn't update immediately
- Need to track whether we've consumed a newline more carefully

**Fix:**
```zig
fn nextMarkdown(self: *Tokenizer) Token {
    const start = self.index;

    // Skip leading whitespace BEFORE determining state
    while (self.index < self.buffer.len and
           (self.buffer[self.index] == ' ' or self.buffer[self.index] == '\t')) {
        self.index += 1;
    }

    // NOW check if we're at start of line
    const at_line_start = self.index == self.line_start or
                          (self.index > 0 and self.buffer[self.index - 1] == '\n');

    var state: State = if (at_line_start) .start_of_line else .start;

    // ... rest of logic
}
```

### Solution 2: Add Word Boundary Detection for Emphasis/Strong

**Current broken logic:**
```zig
'*' => {
    state = .maybe_strong_or_emphasis;
    self.index += 1;
},
```

**Fix:**
```zig
'*' => {
    // Only treat as emphasis/strong if at word boundary
    const prev_is_boundary = self.index == 0 or
                             self.buffer[self.index - 1] == ' ' or
                             self.buffer[self.index - 1] == '\n';

    if (prev_is_boundary) {
        state = .maybe_strong_or_emphasis;
        self.index += 1;
    } else {
        // Treat as regular text
        state = .text;
    }
},
```

### Solution 3: Add Debugging to Find Infinite Loop

**Strategy:**
Add trace logging to see where we're stuck:

```zig
pub fn next(self: *Tokenizer) Token {
    if (self.index > self.buffer.len) {
        std.debug.print("ERROR: index past buffer!\n", .{});
        return .{ .tag = .eof, .loc = .{ .start = @intCast(self.index), .end = @intCast(self.index) } };
    }

    const start_index = self.index;
    const result = switch (self.mode) {
        .markdown => self.nextMarkdown(),
        .jsx => self.nextJsx(),
        .expression => self.nextExpression(),
    };

    if (self.index == start_index and result.tag != .eof) {
        std.debug.print("WARNING: Token didn't advance index! mode={s} tag={s}\n",
                       .{@tagName(self.mode), @tagName(result.tag)});
    }

    return result;
}
```

**In Parser:**
```zig
fn parseBlock(p: *Parser) error{ OutOfMemory, ParseError }!Ast.NodeIndex {
    const start_index = p.token_index;
    std.debug.print("parseBlock at token {d}: {s}\n",
                   .{start_index, @tagName(p.token_tags[p.token_index])});

    const result = switch (p.token_tags[p.token_index]) {
        // ... existing logic
    };

    std.debug.print("  -> created node type {s}\n", .{@tagName(p.nodes.get(result).tag)});
    return result;
}
```

### Solution 4: Fix parseDocument() to Properly Create Root

**Current issue:**
The document node should be at index 0, but it's not appearing.

**Potential fix:**
```zig
fn parseDocument(p: *Parser) !Ast.NodeIndex {
    // Reserve the document node FIRST, at index 0
    const doc_index = try p.reserveNode(.document);
    std.debug.assert(doc_index == 0); // Should always be first node
    errdefer p.unreserveNode(doc_index);

    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    // Check for frontmatter
    if (p.eatToken(.frontmatter_start)) |fm_start| {
        const fm_node = try p.parseFrontmatter(fm_start);
        try p.scratch.append(fm_node);
    }

    // Parse top-level blocks
    while (p.token_tags[p.token_index] != .eof) {
        // Skip blank lines between blocks
        while (p.eatToken(.blank_line)) |_| {}

        if (p.token_tags[p.token_index] == .eof) break;

        const block = p.parseBlock() catch |err| {
            if (err == error.ParseError) {
                p.findNextBlock();
                continue;
            }
            return err;
        };

        try p.scratch.append(block);
    }

    const children_span = try p.listToSpan(p.scratch.items[scratch_top..]);

    // NOW set the document node with proper data
    return p.setNode(doc_index, .{
        .tag = .document,
        .main_token = 0,
        .data = .{ .children = children_span },
    });
}
```

### Solution 5: Simplify the CLI to Just Print Flat Node List

**Current issue:**
The recursive tree printing might have cycles or be accessing wrong children.

**Quick fix:**
```zig
fn printAst(writer: anytype, ast: mdx.Ast) !void {
    try writer.print("=== AST ===\n", .{});
    try writer.print("Nodes: {d}\n", .{ast.nodes.len});
    try writer.print("Tokens: {d}\n\n", .{ast.tokens.len});

    // Just print flat list, no recursion
    for (0..ast.nodes.len) |i| {
        const node_idx: mdx.Ast.NodeIndex = @intCast(i);
        const node = ast.nodes.get(node_idx);

        try writer.print("[{d}] {s} (token={d})\n",
                       .{node_idx, @tagName(node.tag), node.main_token});
    }

    // Skip tree printing for now
}
```

### Solution 6: Add Safety Limits

**Prevent infinite loops:**
```zig
pub fn parse(gpa: Allocator, source: [:0]const u8) !Ast {
    // ... tokenization

    // Safety check
    if (tokens.items.len > source.len * 2) {
        std.debug.print("ERROR: Too many tokens ({d}) for source length ({d})\n",
                       .{tokens.items.len, source.len});
        return error.TokenizerError;
    }

    // ... parsing
}

fn parseDocument(p: *Parser) !Ast.NodeIndex {
    var iterations: u32 = 0;
    while (p.token_tags[p.token_index] != .eof) {
        iterations += 1;
        if (iterations > 10000) {
            std.debug.print("ERROR: parseDocument infinite loop detected!\n", .{});
            return error.ParseError;
        }

        // ... existing logic
    }
}
```

---

## Recommended Fix Order

1. **FIRST: Add debugging** (Solution 3) - See what's actually happening
2. **SECOND: Fix start-of-line detection** (Solution 1) - Core tokenizer issue
3. **THIRD: Fix emphasis/strong detection** (Solution 2) - Stop creating spurious tokens
4. **FOURTH: Fix parseDocument** (Solution 4) - Ensure document node exists
5. **FIFTH: Simplify CLI** (Solution 5) - Remove recursive printing
6. **SIXTH: Add safety limits** (Solution 6) - Prevent hangs during development

---

## Quick Debug Steps

### Step 1: See what tokens are being generated

Add to `parse()` in Parser.zig:
```zig
// After tokenization, before parsing
std.debug.print("=== TOKENS ===\n", .{});
for (tokens.items, 0..) |tok, i| {
    const text = source[tok.loc.start..tok.loc.end];
    std.debug.print("[{d}] {s}: \"{s}\"\n", .{i, @tagName(tok.tag), text});
    if (i > 100) {
        std.debug.print("... (stopping at 100 tokens)\n", .{});
        break;
    }
}
```

### Step 2: See what the parser is doing

Add to `parseDocument()`:
```zig
while (p.token_tags[p.token_index] != .eof) {
    std.debug.print("Parse loop: token_index={d}, tag={s}\n",
                   .{p.token_index, @tagName(p.token_tags[p.token_index])});

    // ... existing logic

    if (p.token_index > 100) {
        std.debug.print("ERROR: Too many iterations!\n", .{});
        return error.ParseError;
    }
}
```

### Step 3: Verify node creation

Add to `addNode()`:
```zig
fn addNode(p: *Parser, node: Ast.Node) !Ast.NodeIndex {
    const index: Ast.NodeIndex = @intCast(p.nodes.len);
    try p.nodes.append(p.gpa, node);
    std.debug.print("Created node {d}: {s}\n", .{index, @tagName(node.tag)});
    return index;
}
```

---

## The Real Issue (My Guess)

I think the core problem is **the tokenizer is creating way too many tokens** because:

1. `*` triggers emphasis/strong detection everywhere (not just at word boundaries)
2. Start-of-line detection is broken, so `#` isn't recognized as heading
3. This creates a flood of wrong tokens
4. The parser tries to handle them and gets confused
5. Either the parser loops forever or creates wrong AST structure

**The smoking gun:** Everything is parsed as "strong" nodes - this means the tokenizer is producing tons of `strong_start`/`strong_end` tokens, and the parser is dutifully creating strong nodes for all of them.

**Fix priority:** Fix the tokenizer first, then the parser will probably work fine.
