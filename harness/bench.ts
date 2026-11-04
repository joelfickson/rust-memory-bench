import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { barChart, timelineChart } from "./charts.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "bin");
const DIMS = 768;
const WINDOW = 50;
const USER_BYTES = 2048;
const TOOL_BYTES = 65536;
const MIB = 1024 * 1024;

type Options = { runs: number; vectors: number; turns: number; build: boolean; out: string };

function parseArgs(argv: string[]): Options {
  const opts: Options = { runs: 5, vectors: 10_000, turns: 2_000, build: true, out: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quick") Object.assign(opts, { runs: 1, vectors: 1_000, turns: 100 });
    else if (a === "--runs") opts.runs = Number(argv[++i]);
    else if (a === "--vectors") opts.vectors = Number(argv[++i]);
    else if (a === "--turns") opts.turns = Number(argv[++i]);
    else if (a === "--no-build") opts.build = false;
    else if (a === "--out") opts.out = argv[++i];
    else throw new Error(`unknown flag ${a}`);
  }
  opts.out ||= path.join(ROOT, "results", `${os.platform()}-${os.arch()}`);
  return opts;
}

type Variant = { lang: string; label: string; type: string; allocator: string; cmd: string; args: string[]; env?: Record<string, string> };

const node = process.execPath;
const js = path.join(BIN, "membench.mjs");

const programs = {
  Rust: { cmd: path.join(BIN, "rust-membench"), args: [] as string[], allocator: "system malloc", env: {} },
  "Rust + mimalloc": { cmd: path.join(BIN, "rust-membench-mimalloc"), args: [] as string[], allocator: "mimalloc", env: {} },
  Zig: { cmd: path.join(BIN, "zig-membench"), args: [] as string[], allocator: "libc malloc", env: { MEMBENCH_ALLOCATOR: "libc" } },
  "Zig + smp_allocator": { cmd: path.join(BIN, "zig-membench"), args: [] as string[], allocator: "smp_allocator", env: { MEMBENCH_ALLOCATOR: "smp" } },
  Go: { cmd: path.join(BIN, "go-membench"), args: [] as string[], allocator: "Go GC", env: {} },
  TypeScript: { cmd: node, args: [js], allocator: "V8 GC", env: {} },
};

type Program = keyof typeof programs;

function variant(name: Program, workload: string, n: number, type: string): Variant {
  const p = programs[name];
  return { lang: name.split(" ")[0], label: name, type, allocator: p.allocator, cmd: p.cmd, args: [...p.args, workload, String(n)], env: p.env };
}

function run(cmd: string, args: string[], cwd: string) {
  console.log(`$ ${[cmd, ...args].join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function build() {
  mkdirSync(BIN, { recursive: true });
  run("cargo", ["build", "--release", "--quiet"], path.join(ROOT, "rust"));
  execFileSync("cp", [path.join(ROOT, "rust", "target", "release", "membench"), programs.Rust.cmd]);
  run("cargo", ["build", "--release", "--quiet", "--features", "mimalloc", "--target-dir", "target/mimalloc"], path.join(ROOT, "rust"));
  execFileSync("cp", [path.join(ROOT, "rust", "target", "mimalloc", "release", "membench"), programs["Rust + mimalloc"].cmd]);
  writeFileSync(js, stripTypeScriptTypes(readFileSync(path.join(ROOT, "typescript", "membench.ts"), "utf8")));
  run("go", ["build", "-o", programs.Go.cmd, "."], path.join(ROOT, "go"));
  run("zig", ["build-exe", "membench.zig", "-O", "ReleaseFast", "-lc", `-femit-bin=${programs.Zig.cmd}`], path.join(ROOT, "zig"));
}

type Measurement = { peakBytes: number; seconds: number; checksum: string };

function timeArgs(): string[] {
  return os.platform() === "darwin" ? ["-l"] : ["-v"];
}

function parseTime(text: string): { peakBytes: number; seconds: number } {
  if (os.platform() === "darwin") {
    const peak = text.match(/(\d+)\s+maximum resident set size/);
    const real = text.match(/([\d.]+)\s+real/);
    if (!peak || !real) throw new Error(`cannot parse time output:\n${text}`);
    return { peakBytes: Number(peak[1]), seconds: Number(real[1]) };
  }
  const peak = text.match(/Maximum resident set size \(kbytes\): (\d+)/);
  const wall = text.match(/Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([\d:.]+)/);
  if (!peak || !wall) throw new Error(`cannot parse time output:\n${text}`);
  const seconds = wall[1].split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
  return { peakBytes: Number(peak[1]) * 1024, seconds };
}

function measure(v: Variant): Measurement {
  const result = spawnSyncCapture("/usr/bin/time", [...timeArgs(), v.cmd, ...v.args], v.env);
  if (result.status !== 0) throw new Error(`${v.label} exited ${result.status}\n${result.text}`);
  const checksum = result.text.match(/checksum=(\S+)/);
  if (!checksum) throw new Error(`${v.label} printed no checksum\n${result.text}`);
  return { ...parseTime(result.text), checksum: checksum[1] };
}

function spawnSyncCapture(cmd: string, args: string[], env: Record<string, string> = {}): { status: number | null; text: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * MIB, env: { ...process.env, ...env } });
  return { status: r.status, text: `${r.stdout}\n${r.stderr}` };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type Row = { lang: string; label: string; type: string; allocator: string; workload: string; runs: number[]; medianMiB: number; seconds: number; checksum: string };

function bench(workload: string, variants: Variant[], runs: number, expected: string): Row[] {
  const rows: Row[] = [];
  for (const v of variants) {
    const ms: Measurement[] = [];
    for (let i = 0; i < runs; i++) ms.push(measure(v));
    const checksum = ms[0].checksum;
    if (ms.some((m) => m.checksum !== checksum)) throw new Error(`${v.label}: checksum changed between runs`);
    if (Number(checksum) !== Number(expected)) throw new Error(`${v.label} ${workload}: checksum ${checksum}, expected ${expected}`);
    const row: Row = {
      lang: v.lang,
      label: v.label,
      type: v.type,
      allocator: v.allocator,
      workload,
      runs: ms.map((m) => round(m.peakBytes / MIB)),
      medianMiB: round(median(ms.map((m) => m.peakBytes)) / MIB),
      seconds: Math.round(median(ms.map((m) => m.seconds)) * 100) / 100,
      checksum,
    };
    console.log(`${workload.padEnd(11)} ${`${v.label} ${v.type}`.padEnd(40)} ${row.medianMiB.toFixed(1).padStart(8)} MiB   runs ${row.runs.map((r) => r.toFixed(1)).join(" ")}   checksum ok`);
    rows.push(row);
  }
  return rows;
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

function expectedEmbeddings(n: number): string {
  const k = n * DIMS;
  const full = Math.floor(k / 1024);
  const rem = k % 1024;
  return String(full * ((1023 * 1024) / 2) + (rem * (rem - 1)) / 2 + k * 0.5);
}

function expectedSession(turns: number): string {
  const history: { len: number; byte: number }[] = [];
  let checksum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const ch = 97 + (turn % 26);
    history.push({ len: USER_BYTES, byte: ch }, { len: TOOL_BYTES, byte: ch - 32 });
    while (history.length > WINDOW * 2) history.shift();
    const total = history.reduce((a, m) => a + m.len, 0);
    let at = total >> 1;
    let byte = 0;
    for (const m of history) {
      if (at < m.len) {
        byte = m.byte;
        break;
      }
      at -= m.len;
    }
    checksum += total + byte;
  }
  return String(checksum);
}

async function timeline(v: Variant, intervalMs = 10): Promise<{ t: number; mib: number }[]> {
  const child = spawn(v.cmd, v.args, { stdio: "ignore", env: { ...process.env, ...v.env } });
  const start = performance.now();
  const points: { t: number; mib: number }[] = [];
  let done = false;
  child.on("exit", () => (done = true));
  while (!done) {
    const r = spawnSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" });
    const kib = Number(r.stdout.trim());
    if (kib > 0) points.push({ t: Math.round(performance.now() - start), mib: round((kib * 1024) / MIB) });
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return points;
}

function versions() {
  const cmd = (c: string, a: string[]) => execFileSync(c, a, { encoding: "utf8" }).trim().split("\n")[0];
  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? "unknown",
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    rust: cmd("rustc", ["--version"]),
    zig: cmd("zig", ["version"]),
    go: cmd("go", ["version"]),
    node: process.version,
  };
}

function table(rows: Row[], payloadMiB: (r: Row) => number): string {
  const lines = ["| Program | Type | Allocator | Peak memory (MiB) | Over live data | Wall time (s) | Runs (MiB) |", "| --- | --- | --- | ---: | ---: | ---: | --- |"];
  for (const r of rows) {
    const over = payloadMiB(r) ? `${(r.medianMiB / payloadMiB(r)).toFixed(2)}x` : "";
    lines.push(`| ${r.label} | \`${r.type}\` | ${r.allocator} | ${r.medianMiB.toFixed(1)} | ${over} | ${r.seconds.toFixed(2)} | ${r.runs.map((x) => x.toFixed(1)).join(", ")} |`);
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) build();
  mkdirSync(opts.out, { recursive: true });
  const env = versions();
  console.log(env);

  const noop = bench(
    "noop",
    (Object.keys(programs) as Program[]).map((p) => variant(p, "noop", 0, "empty")),
    opts.runs,
    "0",
  );

  const n = opts.vectors;
  const embeddings = bench(
    "embeddings",
    [
      variant("Rust", "embeddings", n, "Vec<Vec<f32>>"),
      variant("Rust + mimalloc", "embeddings", n, "Vec<Vec<f32>>"),
      variant("Zig", "embeddings", n, "[][]f32"),
      variant("Zig + smp_allocator", "embeddings", n, "[][]f32"),
      variant("Go", "embeddings", n, "[][]float32"),
      variant("TypeScript", "embeddings-float32", n, "Float32Array[]"),
      variant("Rust", "embeddings-f64", n, "Vec<Vec<f64>>"),
      variant("TypeScript", "embeddings-number", n, "number[][]"),
    ],
    opts.runs,
    expectedEmbeddings(n),
  );

  const session = bench(
    "session",
    [
      variant("Rust", "session", opts.turns, "String"),
      variant("Rust + mimalloc", "session", opts.turns, "String"),
      variant("Zig", "session", opts.turns, "[]u8"),
      variant("Zig + smp_allocator", "session", opts.turns, "[]u8"),
      variant("Go", "session", opts.turns, "string"),
      variant("TypeScript", "session", opts.turns, "string"),
    ],
    opts.runs,
    expectedSession(opts.turns),
  );

  const timelines: Record<string, { t: number; mib: number }[]> = {};
  const timelineSeries: Program[] = ["TypeScript", "Rust", "Go", "Rust + mimalloc"];
  for (const p of timelineSeries) timelines[p] = await timeline(variant(p, "session", opts.turns, ""));

  const f32MiB = round((n * DIMS * 4) / MIB);
  const f64MiB = round((n * DIMS * 8) / MIB);
  const windowMiB = round((WINDOW * (USER_BYTES + TOOL_BYTES)) / MIB);
  const results = { env, options: { runs: opts.runs, vectors: n, dims: DIMS, turns: opts.turns, window: WINDOW }, noop, embeddings, session, timelines };
  writeFileSync(path.join(opts.out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);

  const footer = `${env.cpu} · ${env.rust.split(" ").slice(0, 2).join(" ")} · Zig ${env.zig} · ${env.go.split(" ")[2]} · Node ${env.node}`;
  writeFileSync(
    path.join(opts.out, "embeddings.svg"),
    barChart({
      title: "Same job, very different memory bills",
      subtitle: `Peak memory to hold ${n.toLocaleString("en-US")} embeddings of ${DIMS} floats. Median of ${opts.runs} runs.`,
      rows: embeddings.map((r) => ({ label: r.label, sub: `${r.type} · ${r.allocator}`, value: r.medianMiB, highlight: r.lang === "Rust" })),
      refs: [
        { value: f32MiB, label: `${f32MiB} MiB raw f32` },
        { value: f64MiB, label: `${f64MiB} MiB raw f64` },
      ],
      footer,
    }),
  );
  writeFileSync(
    path.join(opts.out, "session-peak.svg"),
    barChart({
      title: "A long agent session",
      subtitle: `${opts.turns.toLocaleString("en-US")} turns, ${WINDOW}-turn context window, prompt rebuilt every turn. Peak memory, median of ${opts.runs} runs.`,
      rows: session.map((r) => ({ label: r.label, sub: `${r.type} · ${r.allocator}`, value: r.medianMiB, highlight: r.lang === "Rust" })),
      refs: [{ value: windowMiB * 2, label: `${round(windowMiB * 2)} MiB live data at peak` }],
      footer,
    }),
  );
  writeFileSync(
    path.join(opts.out, "session-timeline.svg"),
    timelineChart({
      title: "Memory over an agent session",
      subtitle: `Resident memory sampled every 10 ms while running ${opts.turns.toLocaleString("en-US")} turns.`,
      series: timelineSeries.map((p) => ({ label: p, points: timelines[p] })),
      footer,
    }),
  );

  const noopOf = (label: string) => noop.find((r) => r.label === label)?.medianMiB ?? 0;
  const md = [
    `# Results: ${env.cpu}, ${env.os}`,
    "",
    `Toolchains: ${env.rust}, Zig ${env.zig}, ${env.go}, Node ${env.node}. ${env.memoryGiB} GiB RAM. Median of ${opts.runs} runs.`,
    "",
    "## Empty program",
    "",
    table(noop, () => 0),
    "",
    `## Embeddings: ${n.toLocaleString("en-US")} x ${DIMS}`,
    "",
    `Raw data is ${f32MiB} MiB as f32 and ${f64MiB} MiB as f64. JavaScript numbers are always 64-bit, so \`number[][]\` is compared against the f64 size.`,
    "",
    table(embeddings, (r) => (r.type.includes("64") || r.type === "number[][]" ? f64MiB : f32MiB)),
    "",
    "Startup cost removed (peak minus the empty program for the same language):",
    "",
    "| Program | Type | Peak minus empty (MiB) |",
    "| --- | --- | ---: |",
    ...embeddings.map((r) => `| ${r.label} | \`${r.type}\` | ${(r.medianMiB - noopOf(r.label)).toFixed(1)} |`),
    "",
    `## Agent session: ${opts.turns.toLocaleString("en-US")} turns`,
    "",
    `The live data at the worst moment is about ${round(windowMiB * 2)} MiB: the ${WINDOW}-turn window (${windowMiB} MiB) plus the prompt built from it (${windowMiB} MiB).`,
    "",
    table(session, () => windowMiB * 2),
    "",
    "![Embeddings](embeddings.svg)",
    "",
    "![Session peak](session-peak.svg)",
    "",
    "![Session timeline](session-timeline.svg)",
    "",
  ].join("\n");
  writeFileSync(path.join(opts.out, "README.md"), md);
  console.log(`\nwrote ${path.relative(ROOT, opts.out)}/`);
}

await main();
