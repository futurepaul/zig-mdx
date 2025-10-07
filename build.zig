const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Library
    const lib = b.addStaticLibrary(.{
        .name = "zigmdx",
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(lib);

    // Executable
    const exe = b.addExecutable(.{
        .name = "mdx-parse",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the MDX parser");
    run_step.dependOn(&run_cmd.step);

    // Tests
    const lib_unit_tests = b.addTest(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });

    const run_lib_unit_tests = b.addRunArtifact(lib_unit_tests);

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_lib_unit_tests.step);

    // WASM build
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const wasm_lib = b.addExecutable(.{
        .name = "zigmdx",
        .root_source_file = b.path("src/wasm_exports.zig"),
        .target = wasm_target,
        .optimize = .ReleaseSmall,
    });

    wasm_lib.rdynamic = true;
    wasm_lib.entry = .disabled;
    wasm_lib.export_memory = true;

    // Set memory limits
    wasm_lib.stack_size = 1024 * 1024; // 1MB stack
    wasm_lib.initial_memory = 16 * 1024 * 1024; // 16MB initial
    wasm_lib.max_memory = 32 * 1024 * 1024; // 32MB max

    b.installArtifact(wasm_lib);

    // Install WASM file to wasm package directory
    const wasm_install_file = b.addInstallFile(
        wasm_lib.getEmittedBin(),
        "wasm/src/mdx.wasm",
    );

    // Create wasm build step
    const wasm_step = b.step("wasm", "Build WASM library");
    wasm_step.dependOn(&wasm_lib.step);
    wasm_step.dependOn(&wasm_install_file.step);
}
