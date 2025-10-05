const std = @import("std");
const Token = @import("Token.zig");
const Allocator = std.mem.Allocator;

/// Abstract Syntax Tree for MDX documents.
/// Uses Structure-of-Arrays (MultiArrayList) for cache-efficient node storage,
/// following the Zig compiler's design patterns.
source: [:0]const u8,
tokens: TokenList,
nodes: NodeList,
extra_data: []const u32,
errors: []const Error,

const Ast = @This();

pub const TokenIndex = u32;
pub const NodeIndex = u32;
pub const ByteOffset = u32;

pub const OptionalTokenIndex = enum(u32) {
    none = std.math.maxInt(u32),
    _,

    pub fn unwrap(self: OptionalTokenIndex) ?TokenIndex {
        return if (self == .none) null else @intFromEnum(self);
    }

    pub fn init(index: ?TokenIndex) OptionalTokenIndex {
        return if (index) |i| @enumFromInt(i) else .none;
    }
};

pub const OptionalNodeIndex = enum(u32) {
    none = std.math.maxInt(u32),
    _,

    pub fn unwrap(self: OptionalNodeIndex) ?NodeIndex {
        return if (self == .none) null else @intFromEnum(self);
    }

    pub fn init(index: ?NodeIndex) OptionalNodeIndex {
        return if (index) |i| @enumFromInt(i) else .none;
    }
};

pub const TokenList = std.MultiArrayList(struct {
    tag: Token.Tag,
    start: ByteOffset,
});

pub const NodeList = std.MultiArrayList(Node);

pub const Node = struct {
    tag: Tag,
    main_token: TokenIndex,
    data: Data,

    pub const Tag = enum {
        // Root
        document,

        // Markdown block nodes
        heading,
        paragraph,
        code_block,
        blockquote,
        list_unordered,
        list_ordered,
        list_item,
        hr,

        // Markdown inline nodes
        text,
        strong,
        emphasis,
        code_inline,
        link,
        image,

        // MDX expression nodes
        mdx_text_expression, // {expr} inline
        mdx_flow_expression, // {\n  expr\n} block

        // MDX JSX nodes
        mdx_jsx_element, // <Component>...</Component>
        mdx_jsx_self_closing, // <Component />
        mdx_jsx_fragment, // <>...</>
        mdx_jsx_attribute, // name={value}

        // MDX ESM nodes
        mdx_esm_import, // import ...
        mdx_esm_export, // export ...

        // Frontmatter
        frontmatter,
    };

    pub const Data = union {
        /// No additional data
        none: void,

        /// Single token reference
        token: TokenIndex,

        /// Two child nodes (e.g., link with text and URL)
        two_nodes: struct {
            lhs: NodeIndex,
            rhs: NodeIndex,
        },

        /// Range in extra_data containing child NodeIndexes
        children: Range,

        /// Index into extra_data for complex node structures
        extra: u32,
    };

    pub const Range = struct {
        start: u32,
        end: u32,
    };
};

pub const Error = struct {
    tag: Tag,
    token: TokenIndex,

    pub const Tag = enum {
        expected_token,
        expected_block_element,
        expected_closing_tag,
        unclosed_expression,
        unclosed_frontmatter,
        invalid_jsx_attribute,
        blank_line_required,
        mismatched_tags,
        unexpected_token,
    };
};

/// Extra data structures for complex nodes
pub const JsxElement = struct {
    name_token: TokenIndex,
    attrs_start: u32,
    attrs_end: u32,
    children_start: u32,
    children_end: u32,
};

pub const Heading = struct {
    level: u8,
    children_start: u32,
    children_end: u32,
};

pub const Link = struct {
    text_node: NodeIndex,
    url_token: TokenIndex,
};

/// SmallSpan optimization: most nodes have 0-2 children
pub const SmallSpan = union(enum) {
    zero_or_one: OptionalNodeIndex,
    multi: Node.Range,

    pub fn len(self: SmallSpan) u32 {
        return switch (self) {
            .zero_or_one => |opt| if (opt.unwrap()) |_| 1 else 0,
            .multi => |range| range.end - range.start,
        };
    }
};

pub fn deinit(tree: *Ast, allocator: Allocator) void {
    tree.tokens.deinit(allocator);
    tree.nodes.deinit(allocator);

    if (tree.extra_data.len > 0) {
        allocator.free(tree.extra_data);
    }

    if (tree.errors.len > 0) {
        allocator.free(tree.errors);
    }

    tree.* = undefined;
}

/// Get slice of child node indexes for a given node
pub fn children(tree: Ast, node: NodeIndex) []const NodeIndex {
    const n = tree.nodes.get(node);
    return switch (n.tag) {
        .document,
        .paragraph,
        .blockquote,
        .list_unordered,
        .list_ordered,
        .list_item,
        .strong,
        .emphasis,
        .mdx_jsx_fragment,
        => {
            const range = n.data.children;
            return @as([]const NodeIndex, @ptrCast(tree.extra_data[range.start..range.end]));
        },
        .heading => {
            const info = tree.headingInfo(node);
            return @as([]const NodeIndex, @ptrCast(tree.extra_data[info.children_start..info.children_end]));
        },
        .mdx_jsx_element => {
            const elem = tree.jsxElement(node);
            return @as([]const NodeIndex, @ptrCast(tree.extra_data[elem.children_start..elem.children_end]));
        },
        else => &[_]NodeIndex{},
    };
}

/// Get text slice for a token
pub fn tokenSlice(tree: Ast, token_index: TokenIndex) []const u8 {
    const token_starts = tree.tokens.items(.start);
    const start = token_starts[token_index];
    const end = if (token_index + 1 < tree.tokens.len)
        token_starts[token_index + 1]
    else
        @as(u32, @intCast(tree.source.len));
    return tree.source[start..end];
}

/// Get the source text span for a node
pub fn nodeSource(tree: Ast, node_index: NodeIndex) []const u8 {
    const n = tree.nodes.get(node_index);
    const start_token = n.main_token;
    const token_starts = tree.tokens.items(.start);

    // Find the last token used by this node
    const end_token = blk: {
        const node_children = tree.children(node_index);
        if (node_children.len > 0) {
            // Use last child's end
            const last_child = node_children[node_children.len - 1];
            break :blk tree.nodes.get(last_child).main_token + 1;
        } else {
            break :blk start_token + 1;
        }
    };

    const start = token_starts[start_token];
    const end = if (end_token < tree.tokens.len)
        token_starts[end_token]
    else
        @as(u32, @intCast(tree.source.len));

    return tree.source[start..end];
}

/// Extract extra data as a specific type
pub fn extraData(tree: Ast, index: u32, comptime T: type) T {
    const fields = @typeInfo(T).@"struct".fields;
    var result: T = undefined;
    inline for (fields, 0..) |field, i| {
        const data_value = tree.extra_data[index + i];
        @field(result, field.name) = switch (@typeInfo(field.type)) {
            .int => @intCast(data_value),
            .@"enum" => @enumFromInt(data_value),
            else => @bitCast(data_value),
        };
    }
    return result;
}

/// Get JSX element details
pub fn jsxElement(tree: Ast, node_index: NodeIndex) JsxElement {
    const n = tree.nodes.get(node_index);
    std.debug.assert(n.tag == .mdx_jsx_element or n.tag == .mdx_jsx_self_closing);
    return tree.extraData(n.data.extra, JsxElement);
}

/// Get heading details
pub fn headingInfo(tree: Ast, node_index: NodeIndex) Heading {
    const n = tree.nodes.get(node_index);
    std.debug.assert(n.tag == .heading);
    return tree.extraData(n.data.extra, Heading);
}

// Tests
test "Ast node sizes" {
    // Verify our memory-efficient design
    try std.testing.expectEqual(1, @sizeOf(Node.Tag));
    try std.testing.expectEqual(4, @sizeOf(TokenIndex));
    // Data is union of void, u32, two u32s, Range (2xu32), so 8 bytes
    try std.testing.expect(@sizeOf(Node.Data) >= 8);
    // Total node size should be reasonably small (tag + main_token + data + padding)
    try std.testing.expect(@sizeOf(Node) <= 20);
}

test "OptionalNodeIndex" {
    const none = OptionalNodeIndex.none;
    try std.testing.expectEqual(@as(?NodeIndex, null), none.unwrap());

    const some = OptionalNodeIndex.init(42);
    try std.testing.expectEqual(@as(?NodeIndex, 42), some.unwrap());
}

test "SmallSpan" {
    const zero = SmallSpan{ .zero_or_one = .none };
    try std.testing.expectEqual(@as(u32, 0), zero.len());

    const one = SmallSpan{ .zero_or_one = OptionalNodeIndex.init(5) };
    try std.testing.expectEqual(@as(u32, 1), one.len());

    const multi = SmallSpan{ .multi = .{ .start = 10, .end = 15 } };
    try std.testing.expectEqual(@as(u32, 5), multi.len());
}
