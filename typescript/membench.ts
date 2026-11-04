const DIMS = 768;
const WINDOW = 50;
const USER_BYTES = 2048;
const TOOL_BYTES = 65536;

const value = (i: number, j: number): number => ((i * DIMS + j) % 1024) + 0.5;

function embeddingsNumber(n: number): number {
  const store: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v: number[] = new Array(DIMS);
    for (let j = 0; j < DIMS; j++) v[j] = value(i, j);
    store.push(v);
  }
  let total = 0;
  for (const v of store) for (const x of v) total += x;
  return total;
}

function embeddingsFloat32(n: number): number {
  const store: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(DIMS);
    for (let j = 0; j < DIMS; j++) v[j] = value(i, j);
    store.push(v);
  }
  let total = 0;
  for (const v of store) for (const x of v) total += x;
  return total;
}

function session(turns: number): number {
  const history: string[] = [];
  let checksum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const ch = String.fromCharCode(97 + (turn % 26));
    history.push(ch.repeat(USER_BYTES));
    history.push(ch.toUpperCase().repeat(TOOL_BYTES));
    while (history.length > WINDOW * 2) history.shift();
    const prompt = history.join("");
    checksum += prompt.length + prompt.charCodeAt(prompt.length >> 1);
  }
  return checksum;
}

const [workload = "noop", raw = "0"] = process.argv.slice(2);
const n = Number(raw);

switch (workload) {
  case "noop":
    console.log("checksum=0");
    break;
  case "embeddings-number":
    console.log(`checksum=${embeddingsNumber(n)}`);
    break;
  case "embeddings-float32":
    console.log(`checksum=${embeddingsFloat32(n)}`);
    break;
  case "session":
    console.log(`checksum=${session(n)}`);
    break;
  default:
    console.error(`unknown workload ${workload}`);
    process.exit(2);
}
