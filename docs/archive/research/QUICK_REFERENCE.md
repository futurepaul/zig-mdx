# Zig Parser Quick Reference Guide

## At a Glance

### File Structure
```
/Users/futurepaul/dev/sec/zig-mdx/
├── tokenizer.zig          (61K) - State machine tokenizer
├── Ast.zig               (145K) - AST structure and node types
├── Parse.zig              (??K) - Parser implementation
└── Documentation
    ├── ZIG_PARSER_ARCHITECTURE_RESEARCH.md  - Complete analysis
    ├── ADVANCED_PATTERNS.md                 - Advanced techniques
    └── QUICK_REFERENCE.md                   - This file
```

---

## Token Consumption Cheat Sheet

```zig
// 1. Optional - returns null if no match
const tok = p.eatToken(.semicolon);
if (tok) |t| { /* had semicolon */ }

// 2. Required - fails if missing
const tok = try p.expectToken(.l_paren);

// 3. Unconditional advance
const tok = p.nextToken();

// 4. Debug assertion (release = no check)
const tok = p.assertToken(.keyword_fn);

// 5. Sequence match
const label = p.eatTokens(&.{ .identifier, .colon });

// 6. Look ahead (no consume)
if (p.tokenTag(p.tok_i) == .keyword_if) {
    // ...
}

// 7. Look behind
const has_label = p.isTokenPrecededByTags(tok, &.{ .identifier, .colon });
```

---

## Node Creation Patterns

### Simple Node (no children)
```zig
return p.addNode(.{
    .tag = .identifier,
    .main_token = ident_token,
    .data = .{ .none = {} },
});
```

### One Child
```zig
return p.addNode(.{
    .tag = .return_expr,
    .main_token = return_token,
    .data = .{ .opt_node = expr_node.toOptional() },
});
```

### Two Children
```zig
return p.addNode(.{
    .tag = .add,
    .main_token = plus_token,
    .data = .{ .node_and_node = .{ lhs, rhs } },
});
```

### Variable Children (use extra_data)
```zig
const scratch_top = p.scratch.items.len;
defer p.scratch.shrinkRetainingCapacity(scratch_top);

while (parseChild()) |child| {
    try p.scratch.append(p.gpa, child);
}

const children = p.scratch.items[scratch_top..];
return p.addNode(.{
    .tag = .block,
    .main_token = lbrace_token,
    .data = .{ .extra_range = try p.listToSpan(children) },
});
```

### Complex Node (structured extra data)
```zig
const extra_index = try p.addExtra(Node.FnProto{
    .params_start = params.start,
    .params_end = params.end,
    .align_expr = .fromOptional(align_expr),
    .callconv_expr = .fromOptional(callconv_expr),
});

return p.addNode(.{
    .tag = .fn_proto,
    .main_token = fn_token,
    .data = .{ .extra_and_opt_node = .{ extra_index, return_type } },
});
```

### Recursive Node (reserve first)
```zig
const block_index = try p.reserveNode(.block);
errdefer p.unreserveNode(block_index);

// Parse children...

return p.setNode(block_index, .{
    .tag = .block,
    .main_token = lbrace,
    .data = .{ /* ... */ },
});
```

---

## Error Handling Patterns

### Warn and Continue
```zig
if (p.tokenTag(p.tok_i) != .semicolon) {
    try p.warn(.expected_semi_after_stmt);
    // Keep parsing
}
```

### Fail and Return Error
```zig
const lparen = try p.expectToken(.l_paren);
// Fails if no lparen, returns error.ParseError
```

### Recoverable Parse
```zig
fn parseElementRecoverable(p: *Parse) !?Node.Index {
    return p.parseElement() catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.ParseError => {
            p.findNextBlock();
            return null;
        },
    };
}
```

### Custom Error with Context
```zig
try p.warnMsg(.{
    .tag = .expected_token,
    .token = p.tok_i,
    .extra = .{ .expected_tag = .r_paren },
});
```

---

## Extra Data Patterns

### Store Struct
```zig
const extra_index = try p.addExtra(MyStruct{
    .field1 = node1,
    .field2 = token2,
    .field3 = .fromOptional(maybe_node),
});
```

### Store List
```zig
const range = try p.listToSpan(nodes_array);
// range.start and range.end are indices into extra_data
```

### Retrieve Struct
```zig
const extra_index = tree.nodeData(node).extra_and_node[0];
const my_struct = tree.extraData(extra_index, MyStruct);
// my_struct.field1, my_struct.field2, etc.
```

### Retrieve List
```zig
const range = tree.nodeData(node).extra_range;
const nodes = tree.extraDataSlice(range, Node.Index);
for (nodes) |child_node| {
    // ...
}
```

---

## Common Parsing Functions

### Parse List
```zig
fn parseList(p: *Parse, comptime open: Token.Tag, comptime close: Token.Tag) !SmallSpan {
    _ = try p.expectToken(open);

    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    while (true) {
        if (p.eatToken(close)) |_| break;

        const item = try p.expectItem();
        try p.scratch.append(p.gpa, item);

        if (p.eatToken(.comma) == null) {
            _ = try p.expectToken(close);
            break;
        }
    }

    const items = p.scratch.items[scratch_top..];
    return switch (items.len) {
        0 => .{ .zero_or_one = .none },
        1 => .{ .zero_or_one = items[0].toOptional() },
        else => .{ .multi = try p.listToSpan(items) },
    };
}
```

### Parse Optional Element
```zig
fn parseOptionalElement(p: *Parse) !?Node.Index {
    if (p.tokenTag(p.tok_i) != .start_token) return null;
    // Parse and return node
}
```

### Parse Required Element
```zig
fn expectElement(p: *Parse) !Node.Index {
    const node = try p.parseOptionalElement();
    return node orelse return p.fail(.expected_element);
}
```

---

## Index Types

```zig
// Node indices
Node.Index            // Non-null node index
Node.OptionalIndex    // Nullable node index

// Token indices
TokenIndex            // u32 token index
OptionalTokenIndex    // Nullable token index

// Extra data indices
ExtraIndex            // Index into extra_data array

// Conversions
node_index.toOptional()                      // Index -> OptionalIndex
opt_node_index.unwrap()                      // OptionalIndex -> ?Index
.fromOptional(maybe_node)                    // ?Index -> OptionalIndex
@intFromEnum(index)                          // Index -> u32
@enumFromInt(integer)                        // u32 -> Index
```

---

## AST Access Patterns

```zig
// Get node tag
const tag = tree.nodeTag(node);

// Get main token
const tok = tree.nodeMainToken(node);

// Get node data
const data = tree.nodeData(node);

// Get token tag
const tok_tag = tree.tokenTag(token_index);

// Get token slice
const text = tree.tokenSlice(token_index);

// Get source for node
const src = tree.getNodeSource(node);
```

---

## Memory Management

### Parser Setup
```zig
var parser: Parse = .{
    .gpa = gpa,
    .source = source,
    .tokens = tokens.slice(),
    .tok_i = 0,
    .errors = .{},
    .nodes = .{},
    .extra_data = .{},
    .scratch = .{},
};
defer parser.errors.deinit(gpa);
defer parser.nodes.deinit(gpa);
defer parser.extra_data.deinit(gpa);
defer parser.scratch.deinit(gpa);
```

### Pre-allocation
```zig
// Estimate based on input size
const estimated_token_count = source.len / 8;
try tokens.ensureTotalCapacity(gpa, estimated_token_count);

const estimated_node_count = (tokens.len + 2) / 2;
try parser.nodes.ensureTotalCapacity(gpa, estimated_node_count);
```

### Transfer Ownership
```zig
return Ast{
    .source = source,
    .tokens = tokens.toOwnedSlice(),
    .nodes = parser.nodes.toOwnedSlice(),
    .extra_data = try parser.extra_data.toOwnedSlice(gpa),
    .errors = try parser.errors.toOwnedSlice(gpa),
};
```

---

## State Machine Pattern

```zig
pub fn next(self: *Tokenizer) Token {
    var result: Token = .{
        .tag = undefined,
        .loc = .{ .start = self.index, .end = undefined },
    };

    state: switch (State.start) {
        .start => switch (self.buffer[self.index]) {
            'a'...'z' => {
                result.tag = .identifier;
                continue :state .identifier;
            },
            ' ', '\t' => {
                self.index += 1;
                result.loc.start = self.index;
                continue :state .start;
            },
            else => result.tag = .invalid,
        },

        .identifier => {
            self.index += 1;
            switch (self.buffer[self.index]) {
                'a'...'z', '0'...'9' => continue :state .identifier,
                else => {},  // Fall through
            }
        },
    }

    result.loc.end = self.index;
    return result;
}
```

---

## Testing Patterns

### Tokenizer Test
```zig
test "tokenize simple" {
    const source = "fn main() {}";
    var tokenizer = Tokenizer.init(source);

    try testing.expectEqual(.keyword_fn, tokenizer.next().tag);
    try testing.expectEqual(.identifier, tokenizer.next().tag);
    try testing.expectEqual(.l_paren, tokenizer.next().tag);
    try testing.expectEqual(.r_paren, tokenizer.next().tag);
    try testing.expectEqual(.l_brace, tokenizer.next().tag);
    try testing.expectEqual(.r_brace, tokenizer.next().tag);
    try testing.expectEqual(.eof, tokenizer.next().tag);
}
```

### Parser Test
```zig
test "parse function" {
    const source = "fn main() {}";
    const gpa = testing.allocator;

    var ast = try parse(gpa, source);
    defer ast.deinit(gpa);

    try testing.expectEqual(0, ast.errors.len);
    try testing.expect(ast.nodes.len > 0);
    try testing.expectEqual(.fn_decl, ast.nodeTag(.root));
}
```

---

## Debugging Helpers

### Dump Token
```zig
pub fn dump(self: *Tokenizer, token: *const Token) void {
    std.debug.print("{s} \"{s}\"\n", .{
        @tagName(token.tag),
        self.buffer[token.loc.start..token.loc.end],
    });
}
```

### Print Node Tree
```zig
pub fn dumpNode(tree: Ast, node: Node.Index, indent: u32) void {
    std.debug.print("{s}{s}\n", .{
        " " ** indent,
        @tagName(tree.nodeTag(node)),
    });

    // Recursively dump children based on node type
    switch (tree.nodeTag(node)) {
        .block => {
            const range = tree.nodeData(node).extra_range;
            const children = tree.extraDataSlice(range, Node.Index);
            for (children) |child| {
                dumpNode(tree, child, indent + 2);
            }
        },
        // ... other node types
        else => {},
    }
}
```

---

## Critical Don'ts

❌ **Don't** add children before parent
```zig
// WRONG
const child = try p.addNode(...);
const parent = try p.addNode(.{ .data = .{ .node = child } });
```

✅ **Do** reserve parent first
```zig
// CORRECT
const parent_index = try p.reserveNode(.parent);
errdefer p.unreserveNode(parent_index);
const child = try p.addNode(...);
return p.setNode(parent_index, .{ .data = .{ .node = child } });
```

---

❌ **Don't** forget to clean up scratch
```zig
// WRONG - leaks scratch space
while (...) {
    try p.scratch.append(p.gpa, node);
}
const items = p.scratch.items;
```

✅ **Do** use defer
```zig
// CORRECT
const scratch_top = p.scratch.items.len;
defer p.scratch.shrinkRetainingCapacity(scratch_top);

while (...) {
    try p.scratch.append(p.gpa, node);
}
const items = p.scratch.items[scratch_top..];
```

---

❌ **Don't** allocate per-field
```zig
// WRONG - multiple allocations
inline for (fields) |field| {
    try p.extra_data.append(p.gpa, data);  // May reallocate each time!
}
```

✅ **Do** ensure capacity once
```zig
// CORRECT - single allocation
try p.extra_data.ensureUnusedCapacity(p.gpa, fields.len);
inline for (fields) |field| {
    p.extra_data.appendAssumeCapacity(data);  // No allocation
}
```

---

❌ **Don't** throw on recoverable errors
```zig
// WRONG - stops entire parse
if (bad_syntax) return error.ParseError;
```

✅ **Do** warn and recover
```zig
// CORRECT - logs error but continues
if (bad_syntax) {
    try p.warn(.bad_syntax);
    p.findNextStatement();
}
```

---

## MDX-Specific Additions

### Mode Tracking
```zig
const Mode = enum {
    markdown,
    jsx_tag,
    jsx_content,
    js_expression,
};

mode_stack: std.ArrayList(Mode),

fn enterMode(p: *Parser, mode: Mode) !void {
    try p.mode_stack.append(p.gpa, mode);
}

fn exitMode(p: *Parser) void {
    _ = p.mode_stack.pop();
}

fn currentMode(p: *Parser) Mode {
    return p.mode_stack.getLast();
}
```

### Nesting Depth Tracking
```zig
jsx_depth: u32 = 0,
brace_depth: u32 = 0,

fn parseJSXElement(p: *Parser) !Node.Index {
    p.jsx_depth += 1;
    defer p.jsx_depth -= 1;

    // ... parse element
}
```

### Context-Aware Tokenization
```zig
fn nextToken(self: *MDXTokenizer) Token {
    return switch (self.mode_stack.getLast()) {
        .markdown => self.nextMarkdownToken(),
        .jsx_tag => self.nextJSXToken(),
        .jsx_content => self.nextJSXContentToken(),
        .js_expression => self.nextJSExprToken(),
    };
}
```

---

## Performance Checklist

- ✅ Use sentinel-terminated strings (`:0`)
- ✅ Pre-allocate based on input size
- ✅ Use `appendAssumeCapacity` after `ensureUnusedCapacity`
- ✅ Add `@branchHint(.cold)` to error paths
- ✅ Store indices not pointers
- ✅ Use MultiArrayList for hot loops
- ✅ Inline small functions
- ✅ Use `comptime` for constant operations
- ✅ Avoid allocations in tokenizer
- ✅ Single-pass parsing (no backtracking)

---

## Quick Reference: Node Data Sizes

All sizes in bytes:

```
Tag:              1 byte enum
TokenIndex:       4 bytes (u32)
Node.Index:       4 bytes (enum(u32))
OptionalIndex:    4 bytes (enum(u32))
ExtraIndex:       4 bytes (enum(u32))

Node struct:      13 bytes total
  tag:            1 byte
  main_token:     4 bytes
  data:           8 bytes (union, largest variant)

Data union:       8 bytes (all variants fit in 64 bits)
```

**Why this matters:**
- Smaller nodes = more fit in cache
- Uniform size = predictable memory layout
- 13 bytes × 1M nodes = ~13 MB (reasonable)

---

## Common Errors and Solutions

### Error: "expected ')', found ';'"
**Problem:** Token consumption out of sync
**Solution:** Check all `expectToken` calls match grammar

### Error: "index out of bounds"
**Problem:** Not checking for EOF before accessing token
**Solution:** Always check `tok_i < tokens.len` in loops

### Error: Memory leak
**Problem:** Forgot `defer deinit()` or `defer shrinkRetainingCapacity()`
**Solution:** Add defer immediately after initialization

### Error: "parent index > child index"
**Problem:** Created child before parent
**Solution:** Use `reserveNode` / `setNode` pattern

### Error: Segfault in extraData
**Problem:** Wrong struct type passed to extraData
**Solution:** Ensure struct matches what was stored with addExtra

---

## Key Takeaways

1. **Two-phase parsing**: Tokenize completely, then parse
2. **Error accumulation**: Never stop on first error
3. **Memory efficiency**: MultiArrayList + extra_data
4. **Type safety**: Use enums for indices
5. **Recovery**: Find anchor points, continue parsing
6. **Ownership**: Clear transfer with `toOwnedSlice()`
7. **Pre-allocation**: Estimate capacity upfront
8. **Consistency**: Follow established patterns

---

## Resources

- **Source Files**: `/Users/futurepaul/dev/sec/zig-mdx/`
  - `tokenizer.zig` - Tokenizer implementation
  - `Ast.zig` - AST structure
  - `Parse.zig` - Parser implementation

- **Documentation**:
  - `ZIG_PARSER_ARCHITECTURE_RESEARCH.md` - Comprehensive guide
  - `ADVANCED_PATTERNS.md` - Advanced techniques
  - This file - Quick reference

- **Official Zig Docs**: https://ziglang.org/documentation/master/
- **Zig Spec**: https://github.com/ziglang/zig-spec

---

Good luck building your MDX parser! 🚀
