use membench::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

struct Counting;

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, SeqCst);
        let now = LIVE.fetch_add(layout.size(), SeqCst) + layout.size();
        PEAK.fetch_max(now, SeqCst);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), SeqCst);
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

struct Snapshot {
    allocs: usize,
    live: isize,
    peak: usize,
}

fn measure<T>(f: impl FnOnce() -> T) -> (T, Snapshot) {
    let base_allocs = ALLOCS.load(SeqCst);
    let base_live = LIVE.load(SeqCst);
    PEAK.store(base_live, SeqCst);
    let out = f();
    let snap = Snapshot {
        allocs: ALLOCS.load(SeqCst) - base_allocs,
        live: LIVE.load(SeqCst) as isize - base_live as isize,
        peak: PEAK.load(SeqCst) - base_live,
    };
    (out, snap)
}

#[test]
fn memory_is_exact_and_deterministic() {
    assert_eq!(std::mem::size_of::<f32>(), 4);
    assert_eq!(std::mem::size_of::<String>(), 24);
    assert_eq!(std::mem::size_of::<Vec<f32>>(), 24);
    assert_eq!(std::mem::size_of::<&str>(), 16);
    assert_eq!(std::mem::size_of::<Option<Box<u32>>>(), 8);
    assert_eq!(std::mem::size_of::<Embedding>(), 32);

    let (store, built) = measure(|| embeddings_f32(10_000, DIMS));
    assert_eq!(built.allocs, 10_001);
    assert_eq!(built.live, 31_040_000);
    assert_eq!(built.live as usize, 10_000 * DIMS * 4 + 10_000 * 32);

    let ((), dropped) = measure(|| drop(store));
    assert_eq!(dropped.allocs, 0);
    assert_eq!(dropped.live, -31_040_000);

    let doc = "a".repeat(1_000_000);

    let (owned, owned_snap) = measure(|| chunk_owned(&doc, 512));
    assert_eq!(owned.len(), 1_954);
    assert_eq!(owned_snap.allocs, 1_955);
    assert_eq!(owned_snap.live, 1_046_896);
    drop(owned);

    let (borrowed, borrowed_snap) = measure(|| chunk_borrowed(&doc, 512));
    assert_eq!(borrowed.len(), 1_954);
    assert_eq!(borrowed_snap.allocs, 1);
    assert_eq!(borrowed_snap.live, 31_264);
    assert_eq!(borrowed_snap.live as usize, 1_954 * 16);
    drop(borrowed);

    let (checksum, session_snap) = measure(|| session(200));
    assert!(checksum > 0);
    assert_eq!(session_snap.live, 0);
    let window_bytes = WINDOW * (USER_BYTES + TOOL_BYTES);
    assert!(session_snap.peak < window_bytes * 2 + 64 * 1024);
}
