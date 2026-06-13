// The reader subagent is consumed as a compiled graph (executor readerStep and
// analyzeCode invoke `readerGraph` directly with explicit config). The old
// `ReaderAgent`/`Agent` class wrapper was removed — it was unused and pulled in
// the deleted `main/` directory.
export { readerGraph } from './graph';
export * from './state';
