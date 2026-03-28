use std::sync::atomic::{AtomicI32, Ordering};

/// Abstraction for cancel/progress signals.
/// `AtomicI32` for native tests, `SabControl` for WASM runtime (SAB-backed).
pub trait ControlSignal {
    fn load(&self) -> i32;
    fn store(&self, val: i32);
}

impl ControlSignal for AtomicI32 {
    fn load(&self) -> i32 { AtomicI32::load(self, Ordering::Relaxed) }
    fn store(&self, val: i32) { AtomicI32::store(self, val, Ordering::Relaxed); }
}

/// SAB-backed control signal — reads/writes `Int32Array[offset]` live.
pub struct SabControl<'a> {
    buf: &'a js_sys::Int32Array,
    offset: u32,
}

impl<'a> SabControl<'a> {
    pub fn new(buf: &'a js_sys::Int32Array, offset: u32) -> Self {
        Self { buf, offset }
    }
}

impl ControlSignal for SabControl<'_> {
    fn load(&self) -> i32 { self.buf.get_index(self.offset) }
    fn store(&self, val: i32) { self.buf.set_index(self.offset, val); }
}
