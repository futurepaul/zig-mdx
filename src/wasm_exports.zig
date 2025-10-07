const std = @import("std");
const mdx = @import("lib.zig");

// Fixed buffer allocator for WASM
var buffer: [8 * 1024 * 1024]u8 = undefined; // 8MB buffer
var fba: ?std.heap.FixedBufferAllocator = null;

fn getAllocator() std.mem.Allocator {
    if (fba == null) {
        fba = std.heap.FixedBufferAllocator.init(&buffer);
    }
    return fba.?.allocator();
}

/// Initialize WASM module
export fn wasm_init() void {
    fba = std.heap.FixedBufferAllocator.init(&buffer);
}

/// Get library version
export fn wasm_get_version() u32 {
    return 1;
}

/// Allocate memory
export fn wasm_alloc(size: usize) ?[*]u8 {
    const mem = getAllocator().alloc(u8, size) catch return null;
    return mem.ptr;
}

/// Free memory
export fn wasm_free(ptr: [*]u8, size: usize) void {
    getAllocator().free(ptr[0..size]);
}

/// Parse MDX source and return JSON AST
/// Returns true on success, false on error
export fn wasm_parse_mdx(
    source_ptr: [*]const u8,
    source_len: u32,
    out_json_ptr: *[*]u8,
    out_json_len: *u32,
) bool {
    const allocator = getAllocator();

    // Allocate sentinel-terminated string
    const source_sentinel = allocator.allocSentinel(u8, source_len, 0) catch return false;
    defer allocator.free(source_sentinel);
    @memcpy(source_sentinel, source_ptr[0..source_len]);

    // Parse the MDX
    var ast = mdx.parse(allocator, source_sentinel) catch return false;
    defer ast.deinit(allocator);

    // Serialize AST to JSON
    var json_string = std.ArrayList(u8).init(allocator);
    defer json_string.deinit();

    serializeAst(&ast, &json_string) catch return false;

    // Allocate output buffer
    const output = allocator.alloc(u8, json_string.items.len) catch return false;
    @memcpy(output, json_string.items);

    out_json_ptr.* = output.ptr;
    out_json_len.* = @intCast(output.len);

    return true;
}

/// Serialize AST to JSON format
fn serializeAst(ast: *const mdx.Ast, output: *std.ArrayList(u8)) !void {
    const writer = output.writer();

    try writer.writeAll("{\"nodes\":[");

    const node_tags = ast.nodes.items(.tag);
    const node_main_tokens = ast.nodes.items(.main_token);

    for (0..node_tags.len) |i| {
        if (i > 0) try writer.writeAll(",");

        const node_idx: mdx.Ast.NodeIndex = @intCast(i);
        const tag = node_tags[i];
        const main_token = node_main_tokens[i];

        try writer.writeAll("{");
        try writer.print("\"index\":{d},", .{i});
        try writer.print("\"type\":\"{s}\",", .{@tagName(tag)});
        try writer.print("\"mainToken\":{d}", .{main_token});

        // Add node-specific data
        switch (tag) {
            .heading => {
                const info = ast.headingInfo(node_idx);
                try writer.print(",\"level\":{d}", .{info.level});
                try writer.print(",\"childrenStart\":{d}", .{info.children_start});
                try writer.print(",\"childrenEnd\":{d}", .{info.children_end});
            },
            .text => {
                const token_text = ast.tokenSlice(main_token);
                try writer.writeAll(",\"text\":");
                try std.json.encodeJsonString(token_text, .{}, writer);
            },
            .document, .paragraph, .blockquote, .list_unordered, .list_ordered, .list_item, .mdx_jsx_fragment => {
                const children = ast.children(node_idx);
                try writer.writeAll(",\"children\":[");
                for (children, 0..) |child_idx, j| {
                    if (j > 0) try writer.writeAll(",");
                    try writer.print("{d}", .{child_idx});
                }
                try writer.writeAll("]");
            },
            .link, .image => {
                const link = ast.extraData(ast.nodes.get(node_idx).data.extra, mdx.Ast.Link);
                const url = ast.tokenSlice(link.url_token);
                try writer.writeAll(",\"url\":");
                try std.json.encodeJsonString(url, .{}, writer);
                try writer.print(",\"textNode\":{d}", .{link.text_node});
            },
            .mdx_jsx_element, .mdx_jsx_self_closing => {
                const elem = ast.jsxElement(node_idx);
                const name = ast.tokenSlice(elem.name_token);
                try writer.writeAll(",\"name\":");
                try std.json.encodeJsonString(name, .{}, writer);
            },
            else => {},
        }

        try writer.writeAll("}");
    }

    try writer.writeAll("],\"tokens\":[");

    // Serialize tokens
    const token_tags = ast.tokens.items(.tag);
    const token_starts = ast.tokens.items(.start);

    for (0..ast.tokens.len) |i| {
        if (i > 0) try writer.writeAll(",");

        const token_idx: mdx.Ast.TokenIndex = @intCast(i);
        const tag = token_tags[i];
        const start = token_starts[i];
        const end = if (token_idx + 1 < ast.tokens.len)
            token_starts[token_idx + 1]
        else
            @as(u32, @intCast(ast.source.len));

        try writer.writeAll("{");
        try writer.print("\"tag\":\"{s}\",", .{@tagName(tag)});
        try writer.print("\"start\":{d},", .{start});
        try writer.print("\"end\":{d}", .{end});
        try writer.writeAll("}");
    }

    try writer.writeAll("],\"errors\":[");

    // Serialize errors
    for (ast.errors, 0..) |err, i| {
        if (i > 0) try writer.writeAll(",");
        try writer.writeAll("{");
        try writer.print("\"tag\":\"{s}\",", .{@tagName(err.tag)});
        try writer.print("\"token\":{d}", .{err.token});
        try writer.writeAll("}");
    }

    try writer.writeAll("],\"source\":");
    try std.json.encodeJsonString(ast.source, .{}, writer);
    try writer.writeAll("}");
}

/// Reset the allocator (useful for freeing all memory at once)
export fn wasm_reset() void {
    if (fba) |*f| {
        f.reset();
    }
}
