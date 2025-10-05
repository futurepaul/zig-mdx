# Advanced Patterns from Zig Parser Implementation

## Table of Contents

1. [SmallSpan Optimization](#smallspan-optimization)
2. [Node Reservation Pattern](#node-reservation-pattern)
3. [Members Pattern for Container Parsing](#members-pattern)
4. [Inline For Loops for Compile-Time Iteration](#inline-for-loops)
5. [Token Sequence Matching](#token-sequence-matching)
6. [Precedence Climbing for Expression Parsing](#precedence-climbing)
7. [Optional Node Loading](#optional-node-loading)

---

## SmallSpan Optimization

This pattern avoids allocating to `extra_data` for small lists (0-2 items):

```zig
const SmallSpan = union(enum) {
    zero_or_one: Node.OptionalIndex,
    multi: Node.SubRange,
};

// Example: function parameters
fn parseParamDeclList(p: *Parse) !SmallSpan {
    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    _ = try p.expectToken(.l_paren);

    // Accumulate params in scratch
    while (true) {
        if (p.eatToken(.r_paren)) |_| break;

        const param = try p.expectParamDecl();
        try p.scratch.append(p.gpa, param);

        switch (p.tokenTag(p.tok_i)) {
            .comma => p.tok_i += 1,
            .r_paren => {
                p.tok_i += 1;
                break;
            },
            else => return p.fail(.expected_comma_after_param),
        }
    }

    const params = p.scratch.items[scratch_top..];

    // Optimize for common cases
    return switch (params.len) {
        0 => SmallSpan{ .zero_or_one = .none },
        1 => SmallSpan{ .zero_or_one = params[0].toOptional() },
        else => SmallSpan{ .multi = try p.listToSpan(params) },
    };
}

// Later use
fn parseFnProto(p: *Parse) !Node.Index {
    // ...
    const params = try p.parseParamDeclList();

    // Branch based on result
    switch (params) {
        .zero_or_one => |param| {
            // Store inline in node data
            return p.addNode(.{
                .tag = .fn_proto_simple,
                .data = .{ .opt_node_and_opt_node = .{ param, return_type } },
            });
        },
        .multi => |span| {
            // Store in extra_data
            return p.addNode(.{
                .tag = .fn_proto_multi,
                .data = .{ .extra_and_opt_node = .{
                    try p.addExtra(Node.SubRange{ .start = span.start, .end = span.end }),
                    return_type,
                } },
            });
        },
    }
}
```

**When to use:**
- For lists that are commonly 0-2 items (parameters, generic args)
- Saves 8 bytes per node in common case
- Trade-off: More node tag variants

---

## Node Reservation Pattern

Critical for recursive structures where parent must appear before children:

```zig
fn parseBlock(p: *Parse) !?Node.Index {
    const lbrace = p.eatToken(.l_brace) orelse return null;

    // RESERVE the node BEFORE parsing children
    const block_index = try p.reserveNode(.block);
    errdefer p.unreserveNode(block_index);

    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    // Parse statements (which may add many nodes)
    while (p.eatToken(.r_brace) == null) {
        const stmt = try p.expectStatement();
        try p.scratch.append(p.gpa, stmt);
    }

    const stmts = p.scratch.items[scratch_top..];

    // NOW set the node's data
    if (stmts.len <= 2) {
        return p.setNode(block_index, .{
            .tag = .block_two,
            .main_token = lbrace,
            .data = .{ .opt_node_and_opt_node = .{
                if (stmts.len >= 1) stmts[0].toOptional() else .none,
                if (stmts.len >= 2) stmts[1].toOptional() else .none,
            } },
        });
    } else {
        return p.setNode(block_index, .{
            .tag = .block,
            .main_token = lbrace,
            .data = .{ .extra_range = try p.listToSpan(stmts) },
        });
    }
}

// Implementation details
fn reserveNode(p: *Parse, tag: Node.Tag) !usize {
    try p.nodes.resize(p.gpa, p.nodes.len + 1);
    p.nodes.items(.tag)[p.nodes.len - 1] = tag;
    return p.nodes.len - 1;
}

fn unreserveNode(p: *Parse, node_index: usize) void {
    if (p.nodes.len == node_index + 1) {
        // Last node, can actually remove
        p.nodes.resize(p.gpa, p.nodes.len - 1) catch unreachable;
    } else {
        // Zombie node - make it harmless
        p.nodes.items(.tag)[node_index] = .unreachable_literal;
        p.nodes.items(.main_token)[node_index] = p.tok_i;
    }
}

fn setNode(p: *Parse, i: usize, elem: Node) Node.Index {
    p.nodes.set(i, elem);
    return @enumFromInt(i);
}
```

**Why this matters:**
- Ensures parent index < child indices
- Simplifies tree walking (can iterate forward)
- Enables pointer stability during parsing

---

## Members Pattern for Container Parsing

Used for structs, enums, etc. where you need fields + declarations:

```zig
const Members = struct {
    len: usize,
    data: Node.Data,
    trailing: bool,  // Was there a trailing comma/semicolon?

    fn toSpan(self: Members, p: *Parse) !Node.SubRange {
        return switch (self.len) {
            0 => p.listToSpan(&.{}),
            1 => p.listToSpan(&.{self.data.opt_node_and_opt_node[0].unwrap().?}),
            2 => p.listToSpan(&.{
                self.data.opt_node_and_opt_node[0].unwrap().?,
                self.data.opt_node_and_opt_node[1].unwrap().?,
            }),
            else => self.data.extra_range,
        };
    }
};

fn parseContainerMembers(p: *Parse) !Members {
    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    var field_state: union(enum) {
        none,
        seen,
        end: Node.Index,  // Found decl after field
        err,
    } = .none;

    var trailing = false;

    while (true) {
        switch (p.tokenTag(p.tok_i)) {
            .keyword_pub => {
                const decl = try p.expectDecl();
                if (field_state == .seen) {
                    field_state = .{ .end = decl };
                }
                try p.scratch.append(p.gpa, decl);
                trailing = false;
            },
            .r_brace, .eof => break,
            else => {
                const field = try p.expectField();
                switch (field_state) {
                    .none => field_state = .seen,
                    .seen, .err => {},
                    .end => |decl_node| {
                        try p.warn(.decl_between_fields);
                        field_state = .err;
                    },
                }
                try p.scratch.append(p.gpa, field);

                if (p.eatToken(.comma)) |_| {
                    trailing = true;
                } else {
                    trailing = false;
                    break;
                }
            },
        }
    }

    const items = p.scratch.items[scratch_top..];

    // Return optimized representation
    if (items.len <= 2) {
        return Members{
            .len = items.len,
            .data = .{ .opt_node_and_opt_node = .{
                if (items.len >= 1) items[0].toOptional() else .none,
                if (items.len >= 2) items[1].toOptional() else .none,
            } },
            .trailing = trailing,
        };
    } else {
        return Members{
            .len = items.len,
            .data = .{ .extra_range = try p.listToSpan(items) },
            .trailing = trailing,
        };
    }
}
```

**State Machine for Field/Decl Interleaving:**
```
none -> seen  (first field)
seen -> seen  (more fields)
seen -> end   (first decl after fields) - ERROR
end  -> err   (more mixed) - suppress further errors
```

---

## Inline For Loops for Compile-Time Iteration

Zig's `inline for` allows compile-time iteration over struct fields:

```zig
fn addExtra(p: *Parse, extra: anytype) !ExtraIndex {
    const fields = std.meta.fields(@TypeOf(extra));

    // Ensure capacity ONCE for all fields
    try p.extra_data.ensureUnusedCapacity(p.gpa, fields.len);

    const result: ExtraIndex = @enumFromInt(p.extra_data.items.len);

    // This loop is UNROLLED at compile time
    inline for (fields) |field| {
        const data: u32 = switch (field.type) {
            Node.Index,
            Node.OptionalIndex,
            OptionalTokenIndex,
            ExtraIndex,
            => @intFromEnum(@field(extra, field.name)),
            TokenIndex => @field(extra, field.name),
            else => @compileError("unexpected field type"),
        };
        p.extra_data.appendAssumeCapacity(data);
    }

    return result;
}

// Retrieving is also unrolled
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

**Benefits:**
- No runtime overhead (fully inlined)
- Type-safe field access
- Compile-time validation
- Single implementation for all struct types

---

## Token Sequence Matching

For parsing fixed sequences like `{ identifier : }`:

```zig
fn eatTokens(p: *Parse, tags: []const Token.Tag) ?TokenIndex {
    const available_tags = p.tokens.items(.tag)[p.tok_i..];
    if (!std.mem.startsWith(Token.Tag, available_tags, tags)) return null;

    const result = p.tok_i;
    p.tok_i += @intCast(tags.len);
    return result;
}

// Usage
fn parseLabel(p: *Parse) ?TokenIndex {
    return p.eatTokens(&.{ .identifier, .colon });
}

fn parseWhileStatement(p: *Parse) !Node.Index {
    // Optional label
    const label = p.eatTokens(&.{ .identifier, .colon });

    // Optional inline
    const inline_token = p.eatToken(.keyword_inline);

    const while_token = try p.expectToken(.keyword_while);
    // ...
}
```

**Pattern for looking back:**
```zig
pub fn isTokenPrecededByTags(
    tree: *const Ast,
    ti: TokenIndex,
    expected_token_tags: []const Token.Tag,
) bool {
    return std.mem.endsWith(
        Token.Tag,
        tree.tokens.items(.tag)[0..ti],
        expected_token_tags,
    );
}

// Usage: check if block has label
fn parseBlock(p: *Parse) !Node.Index {
    const lbrace = try p.expectToken(.l_brace);

    // Look back for label
    const has_label = p.isTokenPrecededByTags(lbrace, &.{ .identifier, .colon });

    // ...
}
```

---

## Precedence Climbing for Expression Parsing

Zig uses operator precedence climbing for binary expressions:

```zig
fn parseExpr(p: *Parse) !Node.Index {
    return p.parseExprPrecedence(0);
}

fn parseExprPrecedence(p: *Parse, min_prec: i32) !Node.Index {
    var lhs = try p.parsePrefixExpr();

    while (true) {
        const op_token = p.tok_i;
        const op_tag = p.tokenTag(op_token);

        const prec = operatorPrecedence(op_tag);
        if (prec < min_prec) break;

        p.tok_i += 1;  // consume operator

        const rhs = try p.parseExprPrecedence(prec + 1);

        lhs = try p.addNode(.{
            .tag = operatorToNodeTag(op_tag),
            .main_token = op_token,
            .data = .{ .node_and_node = .{ lhs, rhs } },
        });
    }

    return lhs;
}

fn operatorPrecedence(tag: Token.Tag) i32 {
    return switch (tag) {
        .pipe_pipe => 10,           // or
        .keyword_and => 20,         // and
        .equal_equal,
        .bang_equal,
        .less_than,
        .greater_than,
        .less_or_equal,
        .greater_or_equal,
        => 30,                      // comparison
        .plus, .minus => 40,        // addition
        .asterisk, .slash => 50,    // multiplication
        else => -1,                 // not an infix operator
    };
}

fn operatorToNodeTag(tag: Token.Tag) Node.Tag {
    return switch (tag) {
        .plus => .add,
        .minus => .sub,
        .asterisk => .mul,
        .slash => .div,
        .equal_equal => .equal_equal,
        .pipe_pipe => .bool_or,
        .keyword_and => .bool_and,
        // ...
        else => unreachable,
    };
}
```

**For MDX with mixed precedence:**
```zig
fn parseInlineContent(p: *MDXParser) !Node.Index {
    var nodes = std.ArrayList(Node.Index).init(p.gpa);
    defer nodes.deinit();

    while (true) {
        switch (p.tokenTag(p.tok_i)) {
            .text => try nodes.append(try p.parseText()),
            .emphasis_marker => try nodes.append(try p.parseEmphasis()),
            .strong_marker => try nodes.append(try p.parseStrong()),
            .link_open => try nodes.append(try p.parseLink()),
            .jsx_brace_open => try nodes.append(try p.parseJSXExpr()),
            else => break,
        }
    }

    return try p.createInlineGroup(nodes.items);
}
```

---

## Optional Node Loading

Pattern for converting `OptionalIndex` arrays to `Index` slices:

```zig
pub fn loadOptionalNodesIntoBuffer(
    comptime size: usize,
    buffer: *[size]Node.Index,
    items: [size]Node.OptionalIndex,
) []Node.Index {
    for (buffer, items, 0..) |*node, opt_node, i| {
        node.* = opt_node.unwrap() orelse return buffer[0..i];
    }
    return buffer[0..];
}

// Usage: function with 0-1 parameters
fn parseFnProto(p: *Parse) !Node.Index {
    // ...
    const first_param: Node.OptionalIndex = try p.parseParamDecl();

    var param_buffer: [1]Node.Index = undefined;
    const params = loadOptionalNodesIntoBuffer(1, &param_buffer, .{first_param});

    // params is now []Node.Index with 0 or 1 elements
}
```

**Alternative: Early return pattern**
```zig
fn parseCall(p: *Parse) !Node.Index {
    // ...
    const first_arg = try p.parseExpr() orelse {
        // No arguments
        return p.addNode(.{
            .tag = .call_zero,
            .data = .{ .node = fn_expr },
        });
    };

    const second_arg = try p.parseExpr() orelse {
        // One argument
        return p.addNode(.{
            .tag = .call_one,
            .data = .{ .node_and_opt_node = .{ fn_expr, first_arg.toOptional() } },
        });
    };

    // Multiple arguments - use extra_data
    const scratch_top = p.scratch.items.len;
    defer p.scratch.shrinkRetainingCapacity(scratch_top);

    try p.scratch.append(p.gpa, first_arg);
    try p.scratch.append(p.gpa, second_arg);

    while (p.eatToken(.comma)) |_| {
        const arg = try p.expectExpr();
        try p.scratch.append(p.gpa, arg);
    }

    return p.addNode(.{
        .tag = .call,
        .data = .{ .extra_range = try p.listToSpan(p.scratch.items[scratch_top..]) },
    });
}
```

---

## Complete MDX-Specific Example

Putting it all together for MDX:

```zig
pub const MDXParser = struct {
    gpa: Allocator,
    source: [:0]const u8,
    tokens: TokenList.Slice,
    tok_i: TokenIndex,
    errors: ErrorList,
    nodes: NodeList,
    extra_data: std.ArrayListUnmanaged(u32),
    scratch: std.ArrayListUnmanaged(Node.Index),

    jsx_depth: u32,
    in_code_block: bool,

    fn parseJSXElement(p: *MDXParser) !Node.Index {
        const tag_open_token = try p.expectToken(.jsx_tag_open);

        // Reserve parent node before children
        const elem_index = try p.reserveNode(.jsx_element);
        errdefer p.unreserveNode(elem_index);

        const tag_name = try p.expectToken(.identifier);

        // Parse attributes
        const attrs_top = p.scratch.items.len;
        defer p.scratch.shrinkRetainingCapacity(attrs_top);

        while (p.parseJSXAttribute()) |attr| {
            try p.scratch.append(p.gpa, attr);
        }

        const attrs = p.scratch.items[attrs_top..];
        const attrs_span = try p.listToSpan(attrs);

        // Self-closing?
        if (p.eatToken(.jsx_self_close)) |_| {
            return p.setNode(elem_index, .{
                .tag = .jsx_self_closing,
                .main_token = tag_name,
                .data = .{ .extra_range = attrs_span },
            });
        }

        _ = try p.expectToken(.jsx_tag_close);

        // Parse children (recursive!)
        p.jsx_depth += 1;
        defer p.jsx_depth -= 1;

        const children_top = p.scratch.items.len;
        defer p.scratch.shrinkRetainingCapacity(children_top);

        while (p.tok_i < p.tokens.len and
            p.tokenTag(p.tok_i) != .jsx_tag_end)
        {
            // Children can be text, JSX, or JS expressions
            const child = try p.parseJSXChild();
            try p.scratch.append(p.gpa, child);
        }

        const children = p.scratch.items[children_top..];
        const children_span = try p.listToSpan(children);

        // Closing tag
        _ = try p.expectToken(.jsx_tag_end);
        const closing_name = try p.expectToken(.identifier);
        _ = try p.expectToken(.jsx_tag_close);

        // Validate matching tags
        const opening = p.tokenSlice(tag_name);
        const closing = p.tokenSlice(closing_name);
        if (!std.mem.eql(u8, opening, closing)) {
            try p.warn(.jsx_tag_mismatch);
        }

        // Store in extra_data
        const extra = try p.addExtra(JSXElement{
            .tag_name = tag_name,
            .attributes = attrs_span,
            .children = children_span,
        });

        return p.setNode(elem_index, .{
            .tag = .jsx_element,
            .main_token = tag_open_token,
            .data = .{ .extra = extra },
        });
    }

    fn parseMarkdownBlock(p: *MDXParser) !Node.Index {
        const scratch_top = p.scratch.items.len;
        defer p.scratch.shrinkRetainingCapacity(scratch_top);

        while (p.tok_i < p.tokens.len) {
            const node = switch (p.tokenTag(p.tok_i)) {
                .heading_marker => try p.parseHeading(),
                .list_marker => try p.parseList(),
                .code_fence => try p.parseCodeBlock(),
                .jsx_tag_open => try p.parseJSXElement(),
                .text => try p.parseParagraph(),
                .eof => break,
                else => {
                    try p.warn(.unexpected_token);
                    p.tok_i += 1;
                    continue;
                },
            } orelse continue;

            try p.scratch.append(p.gpa, node);
        }

        const blocks = p.scratch.items[scratch_top..];
        return p.addNode(.{
            .tag = .root,
            .main_token = 0,
            .data = .{ .extra_range = try p.listToSpan(blocks) },
        });
    }
};
```

---

## Performance Optimizations

### 1. Branch Hints

```zig
fn warn(p: *Parse, error_tag: AstError.Tag) error{OutOfMemory}!void {
    @branchHint(.cold);  // Tell optimizer: this path is rare
    try p.warnMsg(.{ .tag = error_tag, .token = p.tok_i });
}
```

### 2. Capacity Pre-allocation

```zig
pub fn parse(gpa: Allocator, source: [:0]const u8) !AST {
    var tokens = TokenList{};

    // Estimate capacity based on empirical ratios
    const estimated_token_count = source.len / 8;
    try tokens.ensureTotalCapacity(gpa, estimated_token_count);

    // Now appending won't reallocate (usually)
    // ...
}
```

### 3. Assume Capacity After Ensure

```zig
fn addExtra(p: *Parse, extra: anytype) !ExtraIndex {
    const fields = std.meta.fields(@TypeOf(extra));

    // Single allocation check
    try p.extra_data.ensureUnusedCapacity(p.gpa, fields.len);

    const result: ExtraIndex = @enumFromInt(p.extra_data.items.len);

    inline for (fields) |field| {
        // No more allocation checks - we ensured capacity above
        p.extra_data.appendAssumeCapacity(data);
    }

    return result;
}
```

### 4. Token Array Slicing

```zig
fn tokenTag(p: *const Parse, token_index: TokenIndex) Token.Tag {
    // Direct array access - no bounds check in release mode
    return p.tokens.items(.tag)[token_index];
}

fn tokenStart(p: *const Parse, token_index: TokenIndex) ByteOffset {
    return p.tokens.items(.start)[token_index];
}
```

---

## Summary

These advanced patterns enable:

1. **Memory efficiency**: SmallSpan, MultiArrayList
2. **Type safety**: Inline iteration, compile-time validation
3. **Performance**: Branch hints, pre-allocation, assumeCapacity
4. **Correctness**: Node reservation, error recovery
5. **Maintainability**: Consistent patterns, clear ownership

Apply these patterns to your MDX parser for production-quality results.
