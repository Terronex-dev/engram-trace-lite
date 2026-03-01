# Engram Trace Lite

[![npm version](https://img.shields.io/npm/v/@terronex/engram-trace-lite.svg)](https://www.npmjs.com/package/@terronex/engram-trace-lite)
[![Powered by Engram](https://img.shields.io/badge/Powered%20by-Engram-ef4444)](https://github.com/Terronex-dev/engram)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight, stateless memory consolidation for the [Engram](https://github.com/Terronex-dev/engram) ecosystem. Compatible with Engram V2.1 spatial features.

---

## What It Does

Trace Lite manages the lifecycle of memories stored in `.engram` files:

- **Decay** -- Age memories through tiers (hot, warm, cold, archive) based on time, access frequency, and importance
- **Deduplicate** -- Remove near-identical memories using cosine similarity on embeddings
- **Cluster** -- Find groups of related memories among older entries
- **Summarize** -- Collapse clusters into single consolidated memories (requires an LLM)
- **Archive** -- Truncate old content to save space
- **Forget** -- Semantically remove memories matching a query

All operations are stateless pure functions. No background loops, no timers, no side effects.

---

## Install

```bash
npm install @terronex/engram-trace-lite
```

---

## Quick Start

```ts
import { consolidate } from '@terronex/engram-trace-lite';

// Run full consolidation pipeline (no LLM needed)
const { memories, report } = await consolidate(myMemories);

console.log(`Decayed: ${report.decayed}`);
console.log(`Deduplicated: ${report.deduplicated}`);
console.log(`Archived: ${report.archived}`);
console.log(`${report.before.total} -> ${report.after.total} memories`);
```

### With LLM Summarization

```ts
import { consolidate, type Summarizer } from '@terronex/engram-trace-lite';

const summarizer: Summarizer = {
  summarize: async (texts) => {
    // Call any LLM to summarize the cluster
    const response = await myLLM.generate(
      `Consolidate these memories into one:\n${texts.join('\n---\n')}`
    );
    return response;
  },
};

const { memories, report } = await consolidate(myMemories, {
  hotDays: 3,
  warmDays: 14,
}, summarizer);
```

### Individual Phases

Every phase is exported for granular control:

```ts
import { decay, deduplicate, cluster, forget } from '@terronex/engram-trace-lite';

// Just decay
const { memories, changed } = decay(myMemories, { hotDays: 7 });

// Just deduplicate
const { memories, removed } = deduplicate(myMemories, 0.92);

// Just find clusters (returns index arrays)
const clusters = cluster(myMemories, { clusterThreshold: 0.78 });

// Semantically forget
const queryEmbedding = await myEmbedder.embed('sensitive topic');
const { memories, forgotten } = forget(myMemories, queryEmbedding, 0.7);
```

---

## Configuration

All config fields are optional with sensible defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `deduplicateThreshold` | 0.92 | Cosine similarity above which two memories are considered duplicates |
| `clusterThreshold` | 0.78 | Cosine similarity for grouping memories into clusters |
| `minClusterSize` | 3 | Minimum memories in a cluster before summarization |
| `hotDays` | 7 | Days before HOT decays to WARM |
| `warmDays` | 30 | Days before WARM decays to COLD |
| `coldDays` | 365 | Days before COLD decays to ARCHIVE |
| `archiveTruncateLength` | 200 | Truncate ARCHIVE content to this many characters (0 = disabled) |

---

## Memory Shape

Trace Lite expects memories in this format:

```ts
interface Memory {
  id: string;
  content: string;
  embedding: Float32Array;
  tags: string[];
  importance: number;        // 0-1, higher = decays slower
  tier: 'hot' | 'warm' | 'cold' | 'archive';
  createdAt: string;         // ISO 8601
  lastAccessed: string;      // ISO 8601
  accessCount: number;       // bumped on recall, slows decay
  source?: string;
  metadata?: Record<string, unknown>;
}
```

This is compatible with `@terronex/engram` MemoryNode when mapped appropriately.

---

## Decay Model

Memories age through four tiers:

```
HOT  -->  WARM  -->  COLD  -->  ARCHIVE
 7d        30d       365d
```

Two factors slow decay:
- **Access frequency** -- each access adds 0.5 days of protection (max 5 days)
- **Importance** -- multiplies the decay threshold by 1x to 3x (importance 0 = 1x, importance 1 = 3x)

A memory with importance 1.0 and 10 accesses at the HOT tier needs to be ~26 days old before it decays to WARM: `(26 - 5) / 3 = 7`.

---

## Trace Lite vs Trace

This package is part of the Engram ecosystem alongside `@terronex/engram-trace` (full). Here is when to use which:

| | Trace Lite | Trace (Full) |
|---|---|---|
| **Use case** | Apps that manage their own memory loop | Autonomous AI agents |
| **Architecture** | Stateless pure functions | Stateful class with internal timers |
| **Agent loop** | None -- you call consolidate() when ready | Built-in: auto-remember, auto-consolidate on interval/write-count |
| **LLM dependency** | Optional (for summarization only) | Optional (for summarization + auto-importance) |
| **Embedding** | Bring your own (just pass Float32Array) | Built-in embedder with provider support |
| **Background work** | None | Interval-based consolidation timers |
| **Recall** | Not included (use @terronex/engram searchNodes) | Built-in recall with tier filtering and decay boost |
| **Auto-remember** | Not included | Heuristic classifier decides what to store |
| **File I/O** | Not included (you handle save/load) | Built-in .engram file management |
| **Size** | ~300 lines, zero runtime deps | ~1,700 lines, embedder + LLM providers |
| **Ideal for** | Allo, custom apps, teaching systems | Rex, autonomous agents, always-on daemons |

**Rule of thumb:** If your app has a chat loop or event loop that processes input continuously, use Trace. If your app stores and retrieves memories on demand with explicit user actions, use Trace Lite.

---

## Integration with Allo

Allo uses Trace Lite for periodic consolidation, either from the interactive menu or automatically after N writes:

```ts
import { Allo } from '@terronex/allo';
import { consolidate } from '@terronex/engram-trace-lite';

const allo = new Allo({ memoryFile: 'brain.engram' });
await allo.initialize();

// After many writes, consolidate
const memories = allo.getAll();
const { memories: consolidated, report } = await consolidate(memories);
// ... save consolidated memories back
```

---

## License

MIT -- Terronex


## Disclaimer

This software is provided as-is under the MIT license. It is under active development and has not undergone a third-party security audit. The encryption implementation (AES-256-GCM with argon2id/PBKDF2) has not been independently verified.

Do not use this software as the sole protection for sensitive data without your own due diligence. The authors and Terronex are not liable for data loss, security breaches, or any damages arising from the use of this software. See LICENSE for full terms.
