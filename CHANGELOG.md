# Changelog

## 0.1.0 (2026-02-24)

### Features

- Stateless consolidation pipeline: consolidate, decay, deduplicate, cluster, forget
- Pure functions, no side effects, no timers
- Temporal decay with access frequency and importance modifiers
- Deduplication at cosine similarity > 0.92
- Clustering at similarity > 0.78 (min 3 per cluster)
- Optional LLM summarization for cluster merging
- Cosine similarity utility export
- Full TypeScript types
- 17/17 tests passing
- Published to NPM as @terronex/engram-trace-lite
