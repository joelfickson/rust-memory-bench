pub const DIMS: usize = 768;
pub const WINDOW: usize = 50;
pub const USER_BYTES: usize = 2_048;
pub const TOOL_BYTES: usize = 65_536;

pub struct Embedding {
    pub id: u32,
    pub vector: Vec<f32>,
}

pub fn value(i: usize, j: usize, dims: usize) -> f64 {
    ((i * dims + j) % 1024) as f64 + 0.5
}

pub fn embeddings_f32(n: usize, dims: usize) -> Vec<Embedding> {
    (0..n)
        .map(|i| Embedding {
            id: i as u32,
            vector: (0..dims).map(|j| value(i, j, dims) as f32).collect(),
        })
        .collect()
}

pub fn embeddings_f64(n: usize, dims: usize) -> Vec<Vec<f64>> {
    (0..n)
        .map(|i| (0..dims).map(|j| value(i, j, dims)).collect())
        .collect()
}

pub fn checksum_f32(store: &[Embedding]) -> f64 {
    store
        .iter()
        .map(|e| e.vector.iter().map(|&x| x as f64).sum::<f64>())
        .sum()
}

pub fn checksum_f64(store: &[Vec<f64>]) -> f64 {
    store.iter().map(|v| v.iter().sum::<f64>()).sum()
}

pub fn chunk_owned(doc: &str, size: usize) -> Vec<String> {
    doc.as_bytes()
        .chunks(size)
        .map(|c| String::from_utf8(c.to_vec()).unwrap())
        .collect()
}

pub fn chunk_borrowed(doc: &str, size: usize) -> Vec<&str> {
    doc.as_bytes()
        .chunks(size)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect()
}

pub fn session(turns: usize) -> u64 {
    let mut history: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let mut checksum: u64 = 0;
    for turn in 0..turns {
        let ch = (b'a' + (turn % 26) as u8) as char;
        history.push_back(ch.to_string().repeat(USER_BYTES));
        history.push_back(ch.to_ascii_uppercase().to_string().repeat(TOOL_BYTES));
        while history.len() > WINDOW * 2 {
            history.pop_front();
        }
        let total: usize = history.iter().map(|m| m.len()).sum();
        let mut prompt = String::with_capacity(total);
        for m in &history {
            prompt.push_str(m);
        }
        checksum += prompt.len() as u64 + prompt.as_bytes()[prompt.len() / 2] as u64;
    }
    checksum
}
