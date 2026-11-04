import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3;
const out = path.join(ROOT, "results", `${os.platform()}-${os.arch()}`);

type Step = { cmd: string; args: string[]; cwd: string; env?: Record<string, string> };
type Target = { name: string; mode: string; edit: string; cold: (tmp: string) => Step; warm: (tmp: string) => Step; binary?: (tmp: string) => string };

function exec(step: Step): number {
  const start = performance.now();
  execFileSync(step.cmd, step.args, { cwd: step.cwd, env: { ...process.env, ...step.env }, stdio: ["ignore", "ignore", "pipe"] });
  return (performance.now() - start) / 1000;
}

function withEdit<T>(file: string, f: () => T): T {
  const original = readFileSync(file, "utf8");
  appendFileSync(file, "\n");
  try {
    return f();
  } finally {
    writeFileSync(file, original);
  }
}

const rust = (profile: "release" | "debug"): Target => {
  const args = ["build", "--quiet", ...(profile === "release" ? ["--release"] : [])];
  const step = (tmp: string): Step => ({ cmd: "cargo", args, cwd: path.join(ROOT, "rust"), env: { CARGO_TARGET_DIR: tmp } });
  return {
    name: "Rust",
    mode: profile === "release" ? "release, LTO" : "debug",
    edit: path.join(ROOT, "rust", "src", "lib.rs"),
    cold: step,
    warm: step,
    binary: (tmp) => path.join(tmp, profile, "membench"),
  };
};

const zig = (mode: "ReleaseFast" | "Debug"): Target => {
  const step = (tmp: string): Step => ({
    cmd: "zig",
    args: ["build-exe", "membench.zig", "-O", mode, "-lc", "--cache-dir", path.join(tmp, "local"), "--global-cache-dir", path.join(tmp, "global"), `-femit-bin=${path.join(tmp, "membench")}`],
    cwd: path.join(ROOT, "zig"),
  });
  return { name: "Zig", mode, edit: path.join(ROOT, "zig", "membench.zig"), cold: step, warm: step, binary: (tmp) => path.join(tmp, "membench") };
};

const go: Target = {
  name: "Go",
  mode: "default",
  edit: path.join(ROOT, "go", "main.go"),
  cold: (tmp) => ({ cmd: "go", args: ["build", "-o", path.join(tmp, "membench"), "."], cwd: path.join(ROOT, "go"), env: { GOCACHE: path.join(tmp, "cache") } }),
  warm: (tmp) => ({ cmd: "go", args: ["build", "-o", path.join(tmp, "membench"), "."], cwd: path.join(ROOT, "go"), env: { GOCACHE: path.join(tmp, "cache") } }),
  binary: (tmp) => path.join(tmp, "membench"),
};

const tsc = (): Step => ({ cmd: process.execPath, args: [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "typescript"], cwd: ROOT });
const typescript: Target = { name: "TypeScript", mode: "tsc type check", edit: path.join(ROOT, "typescript", "membench.ts"), cold: tsc, warm: tsc };

const targets = [rust("debug"), rust("release"), zig("Debug"), zig("ReleaseFast"), go, typescript];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Result = { name: string; mode: string; coldSeconds: number; editSeconds: number; cold: number[]; edit: number[]; binaryKiB: number | null };
const results: Result[] = [];

for (const t of targets) {
  const cold: number[] = [];
  const edit: number[] = [];
  let binaryKiB: number | null = null;
  for (let i = 0; i < runs; i++) {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "membench-build-"));
    try {
      cold.push(exec(t.cold(tmp)));
      edit.push(withEdit(t.edit, () => exec(t.warm(tmp))));
      if (t.binary) binaryKiB = Math.round(statSync(t.binary(tmp)).size / 1024);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const r = { name: t.name, mode: t.mode, coldSeconds: median(cold), editSeconds: median(edit), cold, edit, binaryKiB };
  results.push(r);
  console.log(`${`${t.name} (${t.mode})`.padEnd(28)} cold ${r.coldSeconds.toFixed(2).padStart(6)} s   edit ${r.editSeconds.toFixed(2).padStart(6)} s   binary ${binaryKiB ?? "-"} KiB`);
}

const versions = {
  cpu: os.cpus()[0]?.model ?? "unknown",
  rust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  zig: execFileSync("zig", ["version"], { encoding: "utf8" }).trim(),
  go: execFileSync("go", ["version"], { encoding: "utf8" }).trim(),
  typescript: execFileSync(process.execPath, [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--version"], { encoding: "utf8" }).trim(),
};

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "build-times.json"), `${JSON.stringify({ versions, runs, results }, null, 2)}\n`);
const md = [
  `# Build times: ${versions.cpu}`,
  "",
  `${versions.rust}, Zig ${versions.zig}, ${versions.go}, TypeScript ${versions.typescript}. Median of ${runs} runs.`,
  "",
  "Cold: no build cache for the project or the standard library. The toolchain is installed and dependencies are downloaded. Edit: append one line to the main source file and rebuild with a warm cache.",
  "",
  "| Language | Mode | Cold (s) | Edit one line (s) | Binary (KiB) |",
  "| --- | --- | ---: | ---: | ---: |",
  ...results.map((r) => `| ${r.name} | ${r.mode} | ${r.coldSeconds.toFixed(2)} | ${r.editSeconds.toFixed(2)} | ${r.binaryKiB ?? "-"} |`),
  "",
].join("\n");
writeFileSync(path.join(out, "build-times.md"), md);
console.log(`\nwrote ${path.relative(ROOT, out)}/build-times.md`);
