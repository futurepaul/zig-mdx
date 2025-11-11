# Deep Dive: Zig Compiler Parser and Tokenizer Architecture

## Executive Summary

This document provides a comprehensive analysis of Zig's compiler parser and tokenizer implementation, specifically designed to guide the implementation of a similar MDX parser in Zig. The analysis covers tokenization patterns, parser architecture, error handling, memory management, and the MultiArrayList pattern for AST storage.

---

## Table of Contents

1. [Tokenizer Architecture](#1-tokenizer-architecture)
2. [Parser Architecture](#2-parser-architecture)
3. [Error Handling System](#3-error-handling-system)
4. [MultiArrayList Pattern for Node Storage](#4-multiarraylist-pattern-for-node-storage)
5. [Extra Data Management](#5-extra-data-management)
6. [Best Practices for MDX Parser](#6-best-practices-for-mdx-parser)
7. [Code Examples and Patterns](#7-code-examples-and-patterns)

---

## 1. Tokenizer Architecture

### 1.1 Core Structure

The Zig tokenizer is implemented as a simple state machine in `/lib/std/zig/tokenizer.zig`:

```zig
pub const Tokenizer = struct {
    buffer: [:0]const u8,  // Source code (sentinel-terminated)
    index: usize,          // Current byte position

    pub fn init(buffer: [:0]const u8) Tokenizer {
        // Skip UTF-8 BOM if present
        return .{
            .buffer = buffer,
            .index = if (std.mem.startsWith(u8, buffer, "\xEF\xBB\xBF")) 3 else 0,
        };
    }
}
```

**Key Insights:**
- Uses sentinel-terminated strings (`:0`) to avoid bounds checking
- Single-pass design - no backtracking required
- Stateless between calls to `next()`
- Skips UTF-8 BOM automatically

### 1.2 Token Structure

```zig
pub const Token = struct {
    tag: Tag,
    loc: Loc,

    pub const Loc = struct {
        start: usize,
        end: usize,
    };

    pub const Tag = enum {
        invalid,
        identifier,
        string_literal,
        number_literal,
        eof,
        // ... many more tags
    };
};
```

**Design Choices:**
- Tokens store **indices** not slices (memory efficient)
- Location is byte offsets, not line/column (performance)
- Tag enum for token classification
- Simple, flat structure for cache efficiency

### 1.3 State Machine Implementation

The state machine uses Zig's labeled `switch` with `continue :state` for transitions:

```zig
pub fn next(self: *Tokenizer) Token {
    var result: Token = .{
        .tag = undefined,
        .loc = .{
            .start = self.index,
            .end = undefined,
        },
    };

    state: switch (State.start) {
        .start => switch (self.buffer[self.index]) {
            0 => {
                if (self.index == self.buffer.len) {
                    return .{
                        .tag = .eof,
                        .loc = .{ .start = self.index, .end = self.index },
                    };
                } else {
                    continue :state .invalid;
                }
            },
            ' ', '\n', '\t', '\r' => {
                self.index += 1;
                result.loc.start = self.index;
                continue :state .start;
            },
            'a'...'z', 'A'...'Z', '_' => {
                result.tag = .identifier;
                continue :state .identifier;
            },
            // ... more cases
        },

        .identifier => {
            self.index += 1;
            switch (self.buffer[self.index]) {
                'a'...'z', 'A'...'Z', '_', '0'...'9' => continue :state .identifier,
                else => {
                    // Check if identifier is a keyword
                    const ident = self.buffer[result.loc.start..self.index];
                    if (Token.getKeyword(ident)) |tag| {
                        result.tag = tag;
                    }
                },
            }
        },
        // ... more states
    }

    result.loc.end = self.index;
    return result;
}
```

**State Machine Patterns:**
- Each state is an enum variant
- Uses `continue :state .next_state` for transitions
- Terminal states fall through to set `loc.end`
- No explicit goto - uses labeled blocks instead

### 1.4 Keyword Handling

```zig
pub const keywords = std.StaticStringMap(Tag).initComptime(.{
    .{ "const", .keyword_const },
    .{ "var", .keyword_var },
    .{ "fn", .keyword_fn },
    // ... all keywords
});

pub fn getKeyword(bytes: []const u8) ?Tag {
    return keywords.get(bytes);
}
```

**Performance Insight:**
- Uses compile-time perfect hashing via `StaticStringMap`
- Keywords checked only after identifier is fully consumed
- O(1) lookup time

### 1.5 Error Recovery Strategy

```zig
.invalid => {
    self.index += 1;
    switch (self.buffer[self.index]) {
        0 => if (self.index == self.buffer.len) {
            result.tag = .invalid;
        } else {
            continue :state .invalid;
        },
        '\n' => result.tag = .invalid,
        else => continue :state .invalid,
    }
}
```

**Recovery Mechanism:**
- Invalid tokens consume until newline or EOF
- Returns `.invalid` tag but continues parsing
- Allows parser to report multiple errors in one pass

---

## 2. Parser Architecture

### 2.1 Parser Structure

Located in `/lib/std/zig/Parse.zig`:

```zig
const Parse = struct {
    gpa: Allocator,                                    // General purpose allocator
    source: []const u8,                                // Source code
    tokens: Ast.TokenList.Slice,                       // Pre-tokenized input
    tok_i: TokenIndex,                                 // Current token index
    errors: std.ArrayListUnmanaged(AstError),         // Error accumulation
    nodes: Ast.NodeList,                               // AST nodes (MultiArrayList)
    extra_data: std.ArrayListUnmanaged(u32),          // Variable-sized data
    scratch: std.ArrayListUnmanaged(Node.Index),       // Temporary working space
};
```

**Key Design Decisions:**
- Two-phase design: tokenize first, then parse
- All tokens available upfront (enables lookahead)
- Errors accumulated, not thrown (recoverable parsing)
- Separate scratch buffer for temporary allocations

### 2.2 The parse() Function Pattern

Entry point in `Ast.zig`:

```zig
pub fn parse(gpa: Allocator, source: [:0]const u8, mode: Mode) Allocator.Error!Ast {
    var tokens = Ast.TokenList{};
    defer tokens.deinit(gpa);

    // Empirically determined capacity estimation
    const estimated_token_count = source.len / 8;
    try tokens.ensureTotalCapacity(gpa, estimated_token_count);

    // Phase 1: Tokenization
    var tokenizer = std.zig.Tokenizer.init(source);
    while (true) {
        const token = tokenizer.next();
        try tokens.append(gpa, .{
            .tag = token.tag,
            .start = @intCast(token.loc.start),
        });
        if (token.tag == .eof) break;
    }

    // Phase 2: Initialize parser
    var parser: Parse = .{
        .source = source,
        .gpa = gpa,
        .tokens = tokens.slice(),
        .errors = .{},
        .nodes = .{},
        .extra_data = .{},
        .scratch = .{},
        .tok_i = 0,
    };
    defer parser.errors.deinit(gpa);
    defer parser.nodes.deinit(gpa);
    defer parser.extra_data.deinit(gpa);
    defer parser.scratch.deinit(gpa);

    // Phase 3: Parse based on mode
    const estimated_node_count = (tokens.len + 2) / 2;
    try parser.nodes.ensureTotalCapacity(gpa, estimated_node_count);

    switch (mode) {
        .zig => try parser.parseRoot(),
        .zon => try parser.parseZon(),
    }

    // Phase 4: Transfer ownership
    return Ast{
        .source = source,
        .mode = mode,
        .tokens = tokens.toOwnedSlice(),
        .nodes = parser.nodes.toOwnedSlice(),
        .extra_data = try parser.extra_data.toOwnedSlice(gpa),
        .errors = try parser.errors.toOwnedSlice(gpa),
    };
}
```

**Architectural Insights:**
- **Capacity pre-allocation**: Uses empirical ratios (8:1 for tokens, 2:1 for nodes)
- **Deferred cleanup**: All temporary data cleaned up on error
- **Ownership transfer**: Parser state moved to Ast at end
- **Estimation optimization**: Avoids repeated reallocations

### 2.3 Token Consumption Patterns

The parser provides four core token consumption methods:

```zig
// 1. Optional consumption - returns null if no match
fn eatToken(p: *Parse, tag: Token.Tag) ?TokenIndex {
    return if (p.tokenTag(p.tok_i) == tag) p.nextToken() else null;
}

// 2. Unconditional advance
fn nextToken(p: *Parse) TokenIndex {
    const result = p.tok_i;
    p.tok_i += 1;
    return result;
}

// 3. Required token - returns error if missing
fn expectToken(p: *Parse, tag: Token.Tag) Error!TokenIndex {
    if (p.tokenTag(p.tok_i) != tag) {
        return p.failMsg(.{
            .tag = .expected_token,
            .token = p.tok_i,
            .extra = .{ .expected_tag = tag },
        });
    }
    return p.nextToken();
}

// 4. Debug assertion - panics if wrong
fn assertToken(p: *Parse, tag: Token.Tag) TokenIndex {
    const token = p.nextToken();
    assert(p.tokenTag(token) == tag);
    return token;
}
```

**Usage Patterns:**
- `eatToken`: Optional syntax elements (modifiers, semicolons)
- `expectToken`: Required syntax (parentheses, braces)
- `nextToken`: When you don't care about the tag
- `assertToken`: Grammar guarantees (debug only)

### 2.4 Recursive Descent Pattern

Example function prototype parsing:

```zig
/// FnProto <- KEYWORD_fn IDENTIFIER? LPAREN ParamDeclList RPAREN ... TypeExpr
fn parseFnProto(p: *Parse) !?Node.Index {
    const fn_token = p.eatToken(.keyword_fn) orelse return null;

    // Reserve node BEFORE parsing children (critical!)
    const fn_proto_index = try p.reserveNode(.fn_proto);
    errdefer p.unreserveNode(fn_proto_index);

    _ = p.eatToken(.identifier);
    const params = try p.parseParamDeclList();
    const align_expr = try p.parseByteAlign();
    const section_expr = try p.parseLinkSection();
    const callconv_expr = try p.parseCallconv();
    _ = p.eatToken(.bang);

    const return_type_expr = try p.parseTypeExpr();
    if (return_type_expr == null) {
        try p.warn(.expected_return_type);
    }

    // Choose node variant based on what was parsed
    if (align_expr == null and section_expr == null and callconv_expr == null) {
        return p.setNode(fn_proto_index, .{
            .tag = .fn_proto_simple,
            .main_token = fn_token,
            .data = .{ .opt_node_and_opt_node = .{
                params.zero_or_one,
                .fromOptional(return_type_expr),
            } },
        });
    }

    // ... complex variant with extra_data
}
```

**Critical Patterns:**
1. **Node reservation**: Reserve before parsing children
2. **errdefer cleanup**: Unreserve on parse failure
3. **Variant selection**: Choose smallest node representation
4. **Null propagation**: Missing elements tracked explicitly

---

## 3. Error Handling System

### 3.1 Error Accumulation

```zig
errors: std.ArrayListUnmanaged(AstError),

pub const Error = struct {
    tag: Tag,
    is_note: bool = false,
    token_is_prev: bool = false,
    token: TokenIndex,
    extra: union {
        none: void,
        expected_tag: Token.Tag,
        offset: usize,
    } = .{ .none = {} },
};
```

**Design Philosophy:**
- Errors are **accumulated**, not thrown
- Parser continues after errors (best-effort recovery)
- Multiple errors can be reported in single pass
- Errors contain context (token, expected value)

### 3.2 Error Reporting Functions

```zig
// Warning - continues parsing
fn warn(p: *Parse, error_tag: AstError.Tag) error{OutOfMemory}!void {
    @branchHint(.cold);  // Optimization hint
    try p.warnMsg(.{ .tag = error_tag, .token = p.tok_i });
}

// Failure - stops current production
fn fail(p: *Parse, tag: Ast.Error.Tag) error{ ParseError, OutOfMemory } {
    @branchHint(.cold);
    return p.failMsg(.{ .tag = tag, .token = p.tok_i });
}

// Core error appending
fn warnMsg(p: *Parse, msg: Ast.Error) error{OutOfMemory}!void {
    @branchHint(.cold);

    // Smart error positioning
    switch (msg.tag) {
        .expected_semi_after_decl,
        .expected_token,
        // ... expected tokens
        => if (msg.token != 0 and !p.tokensOnSameLine(msg.token - 1, msg.token)) {
            var copy = msg;
            copy.token_is_prev = true;  // Point to previous token
            copy.token -= 1;
            return p.errors.append(p.gpa, copy);
        },
        else => {},
    }
    try p.errors.append(p.gpa, msg);
}
```

**Smart Error Positioning:**
- If expected token is on new line, error points to **previous** token
- Improves IDE experience (error at end of incomplete statement)
- Uses `token_is_prev` flag for offset calculation

### 3.3 Error Recovery Strategies

**Container Member Recovery:**
```zig
fn findNextContainerMember(p: *Parse) void {
    var level: u32 = 0;  // Track nesting depth
    while (true) {
        const tok = p.nextToken();
        switch (p.tokenTag(tok)) {
            // Anchors - can start new declarations
            .keyword_test,
            .keyword_pub,
            .keyword_const,
            .keyword_fn,
            => {
                if (level == 0) {
                    p.tok_i -= 1;  // Back up to anchor
                    return;
                }
            },

            // Track nesting
            .l_paren, .l_bracket, .l_brace => level += 1,
            .r_paren, .r_bracket => if (level != 0) level -= 1,
            .r_brace => {
                if (level == 0) {
                    p.tok_i -= 1;
                    return;
                }
                level -= 1;
            },

            // Terminators
            .comma, .semicolon => if (level == 0) return,
            .eof => {
                p.tok_i -= 1;
                return;
            },
            else => {},
        }
    }
}
```

**Recovery Principles:**
1. **Track nesting**: Don't recover inside nested structures
2. **Find anchors**: Look for tokens that can start new constructs
3. **Respect boundaries**: Stop at container boundaries
4. **Back up**: Position before anchor token for retry

---

## 4. MultiArrayList Pattern for Node Storage

### 4.1 The Pattern

Zig uses `MultiArrayList` for cache-efficient, type-safe SOA (Structure of Arrays):

```zig
pub const NodeList = std.MultiArrayList(Node);

pub const Node = struct {
    tag: Tag,              // 1 byte enum
    main_token: TokenIndex, // 4 bytes
    data: Data,            // 8 bytes (union)
};

// Internally becomes three separate arrays:
// tags: []Tag
// main_tokens: []TokenIndex
// data: []Data
```

**Memory Layout Benefits:**
```
Traditional AOS (Array of Structures):
[tag|main_token|data][tag|main_token|data][tag|main_token|data]
  3   4         4      3   4         4      3   4         4
Cache line contains: ~5 complete nodes (64 bytes)

MultiArrayList SOA:
tags:        [tag][tag][tag][tag]...
main_tokens: [tok][tok][tok][tok]...
data:        [data][data][data][data]...

Cache line of tags: ~64 tags (when iterating by type)
```

**Advantages:**
- **Better cache utilization** when processing by field
- **Smaller working set** for tag-only operations
- **Vectorization friendly** (SIMD potential)
- **No padding waste** between fields

### 4.2 Node Access Patterns

```zig
// Get individual fields
pub fn nodeTag(tree: *const Ast, node: Node.Index) Node.Tag {
    return tree.nodes.items(.tag)[@intFromEnum(node)];
}

pub fn nodeMainToken(tree: *const Ast, node: Node.Index) TokenIndex {
    return tree.nodes.items(.main_token)[@intFromEnum(node)];
}

pub fn nodeData(tree: *const Ast, node: Node.Index) Node.Data {
    return tree.nodes.items(.data)[@intFromEnum(node)];
}
```

**Pattern:**
- Use `.items(.field_name)` to get array for specific field
- Index with enum converted to integer
- Minimizes cache misses when iterating nodes

### 4.3 Node Data Union

The `Data` union is carefully designed for size efficiency:

```zig
pub const Data = union {
    node: Index,                                    // Single child
    opt_node: OptionalIndex,                        // Optional child
    token: TokenIndex,                              // Token reference
    node_and_node: struct { Index, Index },         // Two children
    opt_node_and_opt_node: struct { OptionalIndex, OptionalIndex },
    node_and_opt_node: struct { Index, OptionalIndex },
    opt_node_and_node: struct { OptionalIndex, Index },
    node_and_extra: struct { Index, ExtraIndex },   // Child + extra data
    extra_and_node: struct { ExtraIndex, Index },
    extra_and_opt_node: struct { ExtraIndex, OptionalIndex },
    node_and_token: struct { Index, TokenIndex },
    token_and_node: struct { TokenIndex, Index },
    @"for": struct { ExtraIndex, For },             // Special case
    extra_range: SubRange,                          // Variable children
};

comptime {
    assert(@sizeOf(Data) == 8);  // Exactly 64 bits
}
```

**Size Optimization:**
- All variants fit in 64 bits (two u32 values)
- No tag overhead (discriminated by `Node.tag`)
- Variants chosen to minimize extra_data usage

---

## 5. Extra Data Management

### 5.1 The extra_data Array

Variable-sized node information stored in flat `u32` array:

```zig
extra_data: []u32  // Grows as needed during parsing
```

**Why u32?**
- Node indices fit in 32 bits
- Token indices fit in 32 bits
- Small structs can be packed into multiple u32s
- Uniform size simplifies indexing

### 5.2 Storing Data

```zig
fn addExtra(p: *Parse, extra: anytype) Allocator.Error!ExtraIndex {
    const fields = std.meta.fields(@TypeOf(extra));
    try p.extra_data.ensureUnusedCapacity(p.gpa, fields.len);

    const result: ExtraIndex = @enumFromInt(p.extra_data.items.len);

    inline for (fields) |field| {
        const data: u32 = switch (field.type) {
            Node.Index,
            Node.OptionalIndex,
            OptionalTokenIndex,
            ExtraIndex,
            => @intFromEnum(@field(extra, field.name)),
            TokenIndex,
            => @field(extra, field.name),
            else => @compileError("unexpected field type"),
        };
        p.extra_data.appendAssumeCapacity(data);
    }
    return result;
}
```

**Usage Example:**
```zig
const extra_index = try p.addExtra(Node.FnProto{
    .params_start = params.start,
    .params_end = params.end,
    .align_expr = .fromOptional(align_expr),
    .section_expr = .fromOptional(section_expr),
    .callconv_expr = .fromOptional(callconv_expr),
});

return p.addNode(.{
    .tag = .fn_proto,
    .main_token = fn_token,
    .data = .{ .extra_and_opt_node = .{ extra_index, return_type } },
});
```

### 5.3 Retrieving Data

```zig
pub fn extraData(tree: Ast, index: ExtraIndex, comptime T: type) T {
    const fields = std.meta.fields(T);
    var result: T = undefined;

    inline for (fields, 0..) |field, i| {
        @field(result, field.name) = switch (field.type) {
            Node.Index,
            Node.OptionalIndex,
            OptionalTokenIndex,
            ExtraIndex,
            => @enumFromInt(tree.extra_data[@intFromEnum(index) + i]),
            TokenIndex => tree.extra_data[@intFromEnum(index) + i],
            else => @compileError("unexpected field type: " ++ @typeName(field.type)),
        };
    }
    return result;
}
```

**Usage:**
```zig
const extra_index = tree.nodeData(node).extra_and_opt_node[0];
const fn_proto = tree.extraData(extra_index, Node.FnProto);
// Now you have: fn_proto.params_start, fn_proto.params_end, etc.
```

### 5.4 SubRange Pattern

For lists of nodes:

```zig
pub const SubRange = struct {
    start: ExtraIndex,
    end: ExtraIndex,
};

// Store a list
fn listToSpan(p: *Parse, list: []const Node.Index) Allocator.Error!Node.SubRange {
    try p.extra_data.appendSlice(p.gpa, @ptrCast(list));
    return .{
        .start = @enumFromInt(p.extra_data.items.len - list.len),
        .end = @enumFromInt(p.extra_data.items.len),
    };
}

// Retrieve a list
pub fn extraDataSlice(tree: Ast, range: Node.SubRange, comptime T: type) []const T {
    return @ptrCast(tree.extra_data[@intFromEnum(range.start)..@intFromEnum(range.end)]);
}
```

**Use Case:**
```zig
// Store function parameters
const params_range = try p.listToSpan(param_nodes);

// Later retrieve
const params = tree.extraDataSlice(params_range, Node.Index);
for (params) |param_node| {
    // Process each parameter
}
```

### 5.5 Memory Efficiency Analysis

**Space Savings Example:**

Function with 5 parameters:
- Without extra_data: Need array pointer + length = 16 bytes (too large for Data union)
- With extra_data: Single ExtraIndex = 4 bytes ✓

Block with 10 statements:
- Direct: Would need 10 * 4 = 40 bytes
- SubRange: start + end = 8 bytes ✓

**Trade-off:**
- Extra indirection on access (one more array lookup)
- But enables uniform node size (13 bytes)
- And allows more nodes to fit in cache

---

## 6. Best Practices for MDX Parser

### 6.1 Tokenizer Design

```zig
// MDX-specific tokens
pub const Token = struct {
    tag: Tag,
    loc: Loc,

    pub const Tag = enum {
        invalid,
        eof,

        // Markdown tokens
        text,
        heading_marker,    // #, ##, ###, etc.
        list_marker,       // -, *, +
        code_fence,        // ``` or ~~~
        emphasis_marker,   // * or _
        link_open,         // [
        link_close,        // ]
        image_marker,      // !

        // JSX tokens
        jsx_tag_open,      // <
        jsx_tag_close,     // >
        jsx_self_close,    // />
        jsx_tag_end,       // </
        jsx_brace_open,    // {
        jsx_brace_close,   // }

        // JavaScript expression tokens
        js_identifier,
        js_string,
        js_number,
        // ... more
    };
};

pub const Tokenizer = struct {
    buffer: [:0]const u8,
    index: usize,
    mode: Mode,  // Track context: markdown, jsx, or js

    const Mode = enum {
        markdown,
        jsx_tag,
        jsx_attr,
        js_expr,
    };

    pub fn next(self: *Tokenizer) Token {
        // Mode switching based on context
        switch (self.mode) {
            .markdown => return self.nextMarkdown(),
            .jsx_tag => return self.nextJSXTag(),
            .jsx_attr => return self.nextJSXAttr(),
            .js_expr => return self.nextJSExpr(),
        }
    }
};
```

**MDX-Specific Considerations:**
1. **Multi-mode tokenization**: Switch between markdown/JSX/JS contexts
2. **Indentation tracking**: Critical for nested structures
3. **Line-based semantics**: Preserve line information for markdown
4. **Nesting depth**: Track brace/bracket depth for JS expressions

### 6.2 Parser Structure

```zig
pub const MDXParser = struct {
    gpa: Allocator,
    source: [:0]const u8,
    tokens: TokenList.Slice,
    tok_i: TokenIndex,
    errors: ErrorList,
    nodes: NodeList,  // MultiArrayList
    extra_data: std.ArrayListUnmanaged(u32),
    scratch: std.ArrayListUnmanaged(Node.Index),

    // MDX-specific state
    jsx_depth: u32,
    in_code_block: bool,
    current_heading_level: u8,
};

pub fn parse(gpa: Allocator, source: [:0]const u8) !AST {
    // Phase 1: Tokenize
    var tokens = TokenList{};
    defer tokens.deinit(gpa);

    var tokenizer = Tokenizer.init(source);
    while (true) {
        const tok = tokenizer.next();
        try tokens.append(gpa, .{
            .tag = tok.tag,
            .start = @intCast(tok.loc.start),
        });
        if (tok.tag == .eof) break;
    }

    // Phase 2: Parse
    var parser: MDXParser = .{
        .gpa = gpa,
        .source = source,
        .tokens = tokens.slice(),
        .tok_i = 0,
        .errors = .{},
        .nodes = .{},
        .extra_data = .{},
        .scratch = .{},
        .jsx_depth = 0,
        .in_code_block = false,
        .current_heading_level = 0,
    };
    defer parser.deinit();

    try parser.parseDocument();

    return AST{
        .source = source,
        .tokens = tokens.toOwnedSlice(),
        .nodes = parser.nodes.toOwnedSlice(),
        .extra_data = try parser.extra_data.toOwnedSlice(gpa),
        .errors = try parser.errors.toOwnedSlice(gpa),
    };
}
```

### 6.3 Node Design

```zig
pub const Node = struct {
    tag: Tag,
    main_token: TokenIndex,
    data: Data,

    pub const Tag = enum {
        root,

        // Markdown nodes
        paragraph,
        heading,              // Level in extra_data
        list,                 // Items in extra_data (SubRange)
        list_item,
        code_block,           // Language in token, content in extra
        blockquote,
        emphasis,
        strong,
        link,                 // URL in extra_data
        image,

        // JSX nodes
        jsx_element,          // Tag name in token, children in extra
        jsx_self_closing,
        jsx_attribute,
        jsx_expression,       // JS code in extra_data

        // Hybrid nodes
        mdx_jsx_flow,        // JSX in markdown block context
        mdx_jsx_text,        // JSX in markdown inline context
    };

    pub const Data = union {
        none: void,
        token: TokenIndex,
        node: Index,
        opt_node: OptionalIndex,
        node_and_node: struct { Index, Index },
        extra_range: SubRange,
        extra_and_node: struct { ExtraIndex, Index },
        heading: struct { level: u8, _: [7]u8 = undefined },  // Pad to 8 bytes
    };
};
```

### 6.4 Error Recovery for MDX

```zig
fn findNextBlock(p: *MDXParser) void {
    // MDX block elements that can restart parsing
    const block_starters = std.StaticStringMap(void).initComptime(.{
        .{"#"}, .{"##"}, .{"###"},  // Headings
        .{"-"}, .{"*"}, .{"+"},      // Lists
        .{">"}, // Blockquote
        .{"```"}, .{"~~~"},          // Code blocks
    });

    while (p.tok_i < p.tokens.len) {
        const tok_tag = p.tokenTag(p.tok_i);

        switch (tok_tag) {
            .heading_marker,
            .list_marker,
            .code_fence,
            .jsx_tag_open,  // New JSX element
            => {
                // Found potential restart point
                return;
            },
            .eof => {
                return;
            },
            else => {
                p.tok_i += 1;
            },
        }
    }
}
```

### 6.5 Handling Nested JSX in Markdown

```zig
fn parseJSXInMarkdown(p: *MDXParser) !Node.Index {
    const start_depth = p.jsx_depth;

    const tag_open = try p.expectToken(.jsx_tag_open);
    p.jsx_depth += 1;

    const elem_index = try p.reserveNode(.jsx_element);
    errdefer p.unreserveNode(elem_index);

    // Parse tag name
    const tag_name = try p.expectToken(.js_identifier);

    // Parse attributes
    const attrs = try p.parseJSXAttributes();

    // Self-closing or has children?
    if (p.eatToken(.jsx_self_close)) |_| {
        p.jsx_depth -= 1;
        return p.setNode(elem_index, .{
            .tag = .jsx_self_closing,
            .main_token = tag_name,
            .data = .{ .extra_range = try p.listToSpan(attrs) },
        });
    }

    _ = try p.expectToken(.jsx_tag_close);

    // Parse children (may include markdown!)
    const children = try p.parseJSXChildren();

    // Closing tag
    _ = try p.expectToken(.jsx_tag_end);
    _ = try p.expectToken(.js_identifier);  // Should match opening
    _ = try p.expectToken(.jsx_tag_close);

    p.jsx_depth -= 1;
    assert(p.jsx_depth == start_depth);

    // Store tag name + attrs + children in extra_data
    const extra_index = try p.addExtra(JSXElement{
        .tag_name = tag_name,
        .attributes = try p.listToSpan(attrs),
        .children = try p.listToSpan(children),
    });

    return p.setNode(elem_index, .{
        .tag = .jsx_element,
        .main_token = tag_open,
        .data = .{ .extra = extra_index },
    });
}
```

---

## 7. Code Examples and Patterns

### 7.1 Complete Minimal Example

```zig
const std = @import("std");

pub const Token = struct {
    tag: Tag,
    start: u32,
    end: u32,

    pub const Tag = enum {
        eof,
        invalid,
        text,
        tag_open,
        tag_close,
    };
};

pub const Tokenizer = struct {
    source: [:0]const u8,
    index: u32,

    pub fn init(source: [:0]const u8) Tokenizer {
        return .{ .source = source, .index = 0 };
    }

    pub fn next(self: *Tokenizer) Token {
        const start = self.index;

        if (self.index >= self.source.len) {
            return .{
                .tag = .eof,
                .start = start,
                .end = start,
            };
        }

        const c = self.source[self.index];
        switch (c) {
            '<' => {
                self.index += 1;
                return .{
                    .tag = .tag_open,
                    .start = start,
                    .end = self.index,
                };
            },
            '>' => {
                self.index += 1;
                return .{
                    .tag = .tag_close,
                    .start = start,
                    .end = self.index,
                };
            },
            else => {
                // Consume text until special char
                while (self.index < self.source.len) : (self.index += 1) {
                    const ch = self.source[self.index];
                    if (ch == '<' or ch == '>') break;
                }
                return .{
                    .tag = .text,
                    .start = start,
                    .end = self.index,
                };
            },
        }
    }
};

pub const Node = struct {
    tag: Tag,
    main_token: u32,
    data: Data,

    pub const Tag = enum { root, element, text };
    pub const Index = enum(u32) { root = 0, _ };
    pub const OptionalIndex = enum(u32) { none = std.math.maxInt(u32), _ };

    pub const Data = union {
        none: void,
        token: u32,
        children: SubRange,
    };

    pub const SubRange = struct {
        start: u32,
        end: u32,
    };
};

pub const AST = struct {
    source: [:0]const u8,
    tokens: []Token,
    nodes: std.MultiArrayList(Node).Slice,
    extra_data: []u32,

    pub fn deinit(self: *AST, allocator: std.mem.Allocator) void {
        allocator.free(self.tokens);
        self.nodes.deinit(allocator);
        allocator.free(self.extra_data);
    }
};

pub fn parse(allocator: std.mem.Allocator, source: [:0]const u8) !AST {
    // Tokenize
    var tokens = std.ArrayList(Token).init(allocator);
    defer tokens.deinit();

    var tokenizer = Tokenizer.init(source);
    while (true) {
        const tok = tokenizer.next();
        try tokens.append(tok);
        if (tok.tag == .eof) break;
    }

    // Parse
    var nodes = std.MultiArrayList(Node){};
    defer nodes.deinit(allocator);

    var extra_data = std.ArrayList(u32).init(allocator);
    defer extra_data.deinit();

    // Create root
    try nodes.append(allocator, .{
        .tag = .root,
        .main_token = 0,
        .data = .{ .none = {} },
    });

    // ... parsing logic ...

    return AST{
        .source = source,
        .tokens = try tokens.toOwnedSlice(),
        .nodes = nodes.toOwnedSlice(),
        .extra_data = try extra_data.toOwnedSlice(),
    };
}
```

### 7.2 Token-Based Lookahead Pattern

```zig
fn parseElement(p: *Parser) !?Node.Index {
    // Look ahead without consuming
    if (p.tokenTag(p.tok_i) != .tag_open) return null;
    if (p.tokenTag(p.tok_i + 1) != .identifier) return null;

    // Commit to parsing
    const open_tag = p.nextToken();
    const tag_name = p.nextToken();

    // ... rest of parsing
}
```

### 7.3 Scratch Buffer Pattern

```zig
fn parseList(p: *Parser) !Node.Index {
    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    // Accumulate items in scratch
    while (p.parseListItem()) |item| {
        try p.scratch.append(p.gpa, item);
    }

    // Transfer to extra_data
    const items = p.scratch.items[scratch_top..];
    const range = try p.listToSpan(items);

    return p.addNode(.{
        .tag = .list,
        .main_token = list_token,
        .data = .{ .children = range },
    });
}
```

### 7.4 Recoverable Parsing Pattern

```zig
fn expectElementRecoverable(p: *Parser) !?Node.Index {
    return p.expectElement() catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        error.ParseError => {
            p.findNextBlock();
            return null;
        },
    };
}

fn parseDocument(p: *Parser) !void {
    while (p.tok_i < p.tokens.len) {
        const node = p.expectElementRecoverable() catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            // ParseError already handled by expectElementRecoverable
        };

        if (node) |n| {
            try p.scratch.append(p.gpa, n);
        }
    }
}
```

---

## Conclusion

The Zig compiler's parser architecture demonstrates several key principles:

1. **Separation of Concerns**: Tokenization and parsing are distinct phases
2. **Memory Efficiency**: MultiArrayList and extra_data minimize overhead
3. **Error Recovery**: Accumulate errors, continue parsing
4. **Type Safety**: Strong typing with enums for indices
5. **Performance**: Pre-allocation, cache-friendly layouts
6. **Maintainability**: Clear patterns, consistent naming

For an MDX parser:
- Extend the state machine for multi-modal tokenization (Markdown/JSX/JS)
- Use MultiArrayList for nodes to maintain cache efficiency
- Implement recovery at block boundaries
- Track context (nesting depth, code blocks, etc.)
- Store variable-sized data in extra_data array
- Follow the reservation pattern for recursive structures

This architecture scales well and has been proven in production for parsing millions of lines of Zig code.
