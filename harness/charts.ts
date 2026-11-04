const W = 1600;
const H = 900;
const PAD = 96;
const FONT = "Outfit, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const C = {
  bg: "#0b0b0c",
  ink: "#f4f4f5",
  ink2: "#a1a1aa",
  muted: "#71717a",
  rule: "#27272a",
  axis: "#3f3f46",
  bar: "#71717a",
  accent: "#f59e0b",
};
const SERIES: Record<string, string> = {
  TypeScript: "#3987e5",
  Rust: "#d95926",
  Go: "#199e70",
  "Rust + mimalloc": "#c98500",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function frame(title: string, subtitle: string, footer: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>
<text x="${PAD}" y="140" font-size="60" font-weight="600" fill="${C.ink}" letter-spacing="-1">${esc(title)}</text>
<text x="${PAD}" y="196" font-size="26" fill="${C.ink2}">${esc(subtitle)}</text>
${body}
<text x="${PAD}" y="${H - 56}" font-size="20" fill="${C.muted}">${esc(footer)}</text>
<text x="${W - PAD}" y="${H - 56}" font-size="20" fill="${C.muted}" text-anchor="end">github.com/joelfickson/rust-memory-bench</text>
</svg>
`;
}

type BarRow = { label: string; sub: string; value: number; highlight?: boolean };

export function barChart(o: { title: string; subtitle: string; rows: BarRow[]; refs: { value: number; label: string }[]; footer: string }): string {
  const left = 520;
  const right = W - PAD - 170;
  const top = 250;
  const bottom = H - 150;
  const rh = Math.min(92, (bottom - top - 30) / o.rows.length);
  const bh = Math.min(40, rh * 0.48);
  const big = rh >= 80;
  const lf = big ? 28 : 24;
  const sf = big ? 20 : 17;
  const max = Math.max(...o.rows.map((r) => r.value), ...o.refs.map((r) => r.value));
  const x = (v: number) => left + ((right - left) * v) / max;
  const parts: string[] = [];
  const end = top + rh * o.rows.length - (rh - bh) / 2;
  parts.push(`<line x1="${left}" x2="${left}" y1="${top - 10}" y2="${end}" stroke="${C.axis}" stroke-width="2"/>`);
  o.refs.forEach((ref, i) => {
    const rx = x(ref.value);
    parts.push(`<line x1="${rx}" x2="${rx}" y1="${top - 14}" y2="${end + 8}" stroke="${C.ink2}" stroke-width="2" stroke-dasharray="6 6"/>`);
    parts.push(`<text x="${rx + 10}" y="${end + 36 + i * 28}" font-size="20" fill="${C.ink2}">${esc(ref.label)}</text>`);
  });
  o.rows.forEach((r, i) => {
    const y = top + i * rh;
    const w = Math.max(x(r.value) - left, 6);
    parts.push(`<text x="${left - 28}" y="${y + bh / 2 - (big ? 2 : 4)}" text-anchor="end" font-size="${lf}" font-weight="600" fill="${C.ink}">${esc(r.label)}</text>`);
    parts.push(`<text x="${left - 28}" y="${y + bh / 2 + (big ? 26 : 21)}" text-anchor="end" font-size="${sf}" fill="${C.ink2}" font-family="${MONO}">${esc(r.sub)}</text>`);
    parts.push(`<path d="M${left},${y} h${w - 4} a4,4 0 0 1 4,4 v${bh - 8} a4,4 0 0 1 -4,4 h${-(w - 4)} z" fill="${r.highlight ? C.accent : C.bar}"/>`);
    parts.push(`<text x="${left + w + 16}" y="${y + bh / 2 + 9}" font-size="${lf}" font-weight="600" fill="${C.ink}" stroke="${C.bg}" stroke-width="10" paint-order="stroke">${r.value.toFixed(1)} MiB</text>`);
  });
  return frame(o.title, o.subtitle, o.footer, parts.join("\n"));
}

type Series = { label: string; points: { t: number; mib: number }[] };

function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

export function timelineChart(o: { title: string; subtitle: string; series: Series[]; footer: string }): string {
  const left = 200;
  const right = W - PAD - 190;
  const top = 260;
  const bottom = H - 170;
  const maxT = Math.max(...o.series.flatMap((s) => s.points.map((p) => p.t)));
  const maxY = Math.max(...o.series.flatMap((s) => s.points.map((p) => p.mib)));
  const yStep = niceStep(maxY, 4);
  const yMax = Math.ceil(maxY / yStep) * yStep;
  const tStep = niceStep(maxT / 1000, 6);
  const x = (t: number) => left + ((right - left) * t) / maxT;
  const y = (m: number) => bottom - ((bottom - top) * m) / yMax;
  const parts: string[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yStep) {
    parts.push(`<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rule}" stroke-width="1"/>`);
    parts.push(`<text x="${left - 16}" y="${y(v) + 7}" text-anchor="end" font-size="20" fill="${C.ink2}">${v} MiB</text>`);
  }
  for (let s = 0; s * 1000 <= maxT; s += tStep) {
    parts.push(`<text x="${x(s * 1000)}" y="${bottom + 34}" text-anchor="middle" font-size="20" fill="${C.ink2}">${Number(s.toFixed(2))} s</text>`);
  }
  const labels: { y: number; label: string; color: string; value: number }[] = [];
  for (const s of o.series) {
    const color = SERIES[s.label] ?? C.ink;
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.mib).toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${C.bg}" stroke-width="6" stroke-linejoin="round"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`);
    const last = s.points[s.points.length - 1];
    const peak = Math.max(...s.points.map((p) => p.mib));
    parts.push(`<circle cx="${x(last.t)}" cy="${y(last.mib)}" r="5" fill="${color}" stroke="${C.bg}" stroke-width="2"/>`);
    labels.push({ y: y(last.mib), label: s.label, color, value: peak });
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 54);
  for (const l of labels) {
    parts.push(`<rect x="${right + 24}" y="${l.y - 12}" width="14" height="14" rx="3" fill="${l.color}"/>`);
    parts.push(`<text x="${right + 48}" y="${l.y + 1}" font-size="22" font-weight="600" fill="${C.ink}">${esc(l.label)}</text>`);
    parts.push(`<text x="${right + 48}" y="${l.y + 25}" font-size="18" fill="${C.ink2}">peak ${l.value.toFixed(0)} MiB</text>`);
  }
  return frame(o.title, o.subtitle, o.footer, parts.join("\n"));
}
