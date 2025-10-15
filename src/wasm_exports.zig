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

    // Serialize AST to JSON tree structure
    var json_string: std.ArrayList(u8) = .{};
    defer json_string.deinit(allocator);

    mdx.TreeBuilder.serializeTree(&ast, &json_string, allocator) catch return false;

    // Allocate output buffer
    const output = allocator.alloc(u8, json_string.items.len) catch return false;
    @memcpy(output, json_string.items);

    out_json_ptr.* = output.ptr;
    out_json_len.* = @intCast(output.len);

    return true;
}

/// Reset the allocator (useful for freeing all memory at once)
export fn wasm_reset() void {
    if (fba) |*f| {
        f.reset();
    }
}
