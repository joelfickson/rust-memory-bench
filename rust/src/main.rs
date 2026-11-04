use membench::*;

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let workload = args.get(1).map(String::as_str).unwrap_or("noop");
    let n: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(0);
    match workload {
        "noop" => println!("checksum=0"),
        "embeddings" => {
            let store = embeddings_f32(n, DIMS);
            println!("checksum={}", checksum_f32(&store));
        }
        "embeddings-f64" => {
            let store = embeddings_f64(n, DIMS);
            println!("checksum={}", checksum_f64(&store));
        }
        "session" => println!("checksum={}", session(n)),
        other => {
            eprintln!("unknown workload {other}");
            std::process::exit(2);
        }
    }
}
