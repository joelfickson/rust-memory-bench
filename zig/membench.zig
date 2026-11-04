const std = @import("std");

const dims = 768;
const window = 50;
const user_bytes = 2048;
const tool_bytes = 65536;

fn value(i: usize, j: usize) f64 {
    return @as(f64, @floatFromInt((i * dims + j) % 1024)) + 0.5;
}

fn embeddings(gpa: std.mem.Allocator, n: usize) !f64 {
    const store = try gpa.alloc([]f32, n);
    defer gpa.free(store);
    for (store, 0..) |*slot, i| {
        const v = try gpa.alloc(f32, dims);
        for (v, 0..) |*x, j| x.* = @floatCast(value(i, j));
        slot.* = v;
    }
    defer for (store) |v| gpa.free(v);
    var total: f64 = 0;
    for (store) |v| {
        for (v) |x| total += x;
    }
    return total;
}

fn session(gpa: std.mem.Allocator, turns: usize) !u64 {
    var history: std.ArrayList([]u8) = .empty;
    defer {
        for (history.items) |m| gpa.free(m);
        history.deinit(gpa);
    }
    var checksum: u64 = 0;
    for (0..turns) |turn| {
        const ch: u8 = 'a' + @as(u8, @intCast(turn % 26));
        const user = try gpa.alloc(u8, user_bytes);
        @memset(user, ch);
        try history.append(gpa, user);
        const tool = try gpa.alloc(u8, tool_bytes);
        @memset(tool, ch - 32);
        try history.append(gpa, tool);
        while (history.items.len > window * 2) {
            gpa.free(history.orderedRemove(0));
        }
        var total: usize = 0;
        for (history.items) |m| total += m.len;
        const prompt = try gpa.alloc(u8, total);
        defer gpa.free(prompt);
        var at: usize = 0;
        for (history.items) |m| {
            @memcpy(prompt[at..][0..m.len], m);
            at += m.len;
        }
        checksum += prompt.len + prompt[prompt.len / 2];
    }
    return checksum;
}

pub fn main(init: std.process.Init) !void {
    const gpa = if (init.environ_map.get("MEMBENCH_ALLOCATOR")) |name|
        if (std.mem.eql(u8, name, "smp")) std.heap.smp_allocator else std.heap.c_allocator
    else
        std.heap.c_allocator;
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    const workload: []const u8 = if (args.len > 1) args[1] else "noop";
    const n: usize = if (args.len > 2) try std.fmt.parseInt(usize, args[2], 10) else 0;
    if (std.mem.eql(u8, workload, "noop")) {
        std.debug.print("checksum=0\n", .{});
    } else if (std.mem.eql(u8, workload, "embeddings")) {
        std.debug.print("checksum={d:.0}\n", .{try embeddings(gpa, n)});
    } else if (std.mem.eql(u8, workload, "session")) {
        std.debug.print("checksum={d}\n", .{try session(gpa, n)});
    } else {
        std.debug.print("unknown workload {s}\n", .{workload});
        std.process.exit(2);
    }
}
