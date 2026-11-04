# Build times: Apple M1 Max

rustc 1.98.1 (48a229cea 2026-09-01), Zig 0.17.0, go version go1.27.3 darwin/arm64, TypeScript Version 5.9.3. Median of 3 runs.

Cold: no build cache for the project or the standard library. The toolchain is installed and dependencies are downloaded. Edit: append one line to the main source file and rebuild with a warm cache.

| Language | Mode | Cold (s) | Edit one line (s) | Binary (KiB) |
| --- | --- | ---: | ---: | ---: |
| Rust | debug | 0.38 | 0.23 | 655 |
| Rust | release, LTO | 2.70 | 2.63 | 404 |
| Zig | Debug | 3.50 | 1.45 | 2170 |
| Zig | ReleaseFast | 8.04 | 6.02 | 421 |
| Go | default | 2.11 | 0.18 | 2390 |
| TypeScript | tsc type check | 0.97 | 0.94 | - |
