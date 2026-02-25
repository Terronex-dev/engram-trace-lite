# Contributing to Engram Trace Lite

## Development

```bash
git clone https://github.com/Terronex-dev/engram-trace-lite.git
cd engram-trace-lite
npm install
npm test
npm run build
```

## Structure

```
src/
  index.ts          Public API exports
  consolidator.ts   consolidate, decay, deduplicate, cluster, forget
  types.ts          TypeScript interfaces (Memory, ConsolidateReport, etc.)
tests/
  consolidator.test.ts   17 tests covering all functions
```

## Code Style

- TypeScript strict mode, ESM (NodeNext)
- Pure functions only (no side effects, no I/O)
- Named exports only

## License

MIT. Contributions licensed under MIT.
