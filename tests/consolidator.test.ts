import { describe, it, expect } from 'vitest';
import {
  consolidate,
  decay,
  deduplicate,
  cluster,
  forget,
  cosineSimilarity,
  type Memory,
  type Summarizer,
} from '../src/index.js';

// -- Helpers ------------------------------------------------------------------

function makeMemory(overrides: Partial<Memory> & { id: string; content: string }): Memory {
  const dims = 8;
  // Deterministic embedding from content hash
  const emb = new Float32Array(dims);
  for (let i = 0; i < dims; i++) {
    emb[i] = (overrides.content.charCodeAt(i % overrides.content.length) - 96) / 26;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dims; i++) emb[i] /= norm;

  return {
    embedding: emb,
    tags: [],
    importance: 0.5,
    tier: 'hot',
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

function makeOldMemory(id: string, content: string, daysOld: number, tier: Memory['tier'] = 'hot', importance = 0): Memory {
  const date = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  return makeMemory({ id, content, createdAt: date, lastAccessed: date, tier, importance });
}

function makeDuplicatePair(): [Memory, Memory] {
  const emb = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  // Normalize
  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < emb.length; i++) emb[i] /= norm;

  const emb2 = new Float32Array(emb); // exact copy = similarity 1.0
  emb2[0] += 0.01; // tiny perturbation, still > 0.92

  return [
    { ...makeMemory({ id: 'dup1', content: 'HNSW enables fast search' }), embedding: emb },
    { ...makeMemory({ id: 'dup2', content: 'HNSW enables fast search queries' }), embedding: emb2 },
  ];
}

// -- Tests --------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3, 4]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toBe(0);
  });
});

describe('decay', () => {
  it('decays HOT to WARM after hotDays', () => {
    const memories = [makeOldMemory('m1', 'old memory', 10)];
    const { memories: result, changed } = decay(memories, { hotDays: 7 });
    expect(changed).toBe(1);
    expect(result[0].tier).toBe('warm');
  });

  it('does not decay recent memories', () => {
    const memories = [makeOldMemory('m1', 'fresh memory', 2)];
    const { changed } = decay(memories, { hotDays: 7 });
    expect(changed).toBe(0);
  });

  it('respects access count (slows decay)', () => {
    const m = makeOldMemory('m1', 'accessed often', 9, 'hot', 0);
    m.accessCount = 10; // 10 * 0.5 = 5 days boost, effective age = 4
    const { changed } = decay([m], { hotDays: 7 });
    expect(changed).toBe(0); // still hot because effective age < 7
  });

  it('respects importance (slows decay)', () => {
    const m = makeOldMemory('m1', 'important memory', 12);
    m.importance = 1.0; // multiplier = 3x, effective age = 4
    const { changed } = decay([m], { hotDays: 7 });
    expect(changed).toBe(0);
  });

  it('cascades through tiers', () => {
    const m = makeOldMemory('m1', 'ancient', 400, 'cold', 0);
    const { memories: result } = decay([m], { coldDays: 365 });
    expect(result[0].tier).toBe('archive');
  });
});

describe('deduplicate', () => {
  it('removes near-duplicate memories', () => {
    const [a, b] = makeDuplicatePair();
    const { memories, removed } = deduplicate([a, b], 0.92);
    expect(removed).toBe(1);
    expect(memories).toHaveLength(1);
  });

  it('keeps the higher-scored memory', () => {
    const [a, b] = makeDuplicatePair();
    b.importance = 1.0; // b is more important
    const { memories } = deduplicate([a, b], 0.92);
    expect(memories[0].id).toBe('dup2');
  });

  it('does nothing with dissimilar memories', () => {
    const memories = [
      makeMemory({ id: 'm1', content: 'alpha beta gamma' }),
      makeMemory({ id: 'm2', content: 'zzzzz yyyyy xxxxx' }),
    ];
    const { removed } = deduplicate(memories, 0.92);
    expect(removed).toBe(0);
  });
});

describe('cluster', () => {
  it('finds clusters among WARM memories', () => {
    const emb = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const make = (id: string, perturbation: number): Memory => ({
      ...makeMemory({ id, content: `cluster member ${id}` }),
      embedding: emb.map(v => v + perturbation * 0.01) as unknown as Float32Array,
      tier: 'warm',
    });

    const memories = [make('c1', 0), make('c2', 1), make('c3', 2)];
    const result = cluster(memories, { clusterThreshold: 0.78, minClusterSize: 3 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores HOT memories', () => {
    const emb = new Float32Array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const memories: Memory[] = [
      { ...makeMemory({ id: 'h1', content: 'hot' }), embedding: emb, tier: 'hot' },
      { ...makeMemory({ id: 'h2', content: 'hot' }), embedding: emb, tier: 'hot' },
      { ...makeMemory({ id: 'h3', content: 'hot' }), embedding: emb, tier: 'hot' },
    ];
    const result = cluster(memories, { minClusterSize: 3 });
    expect(result).toHaveLength(0);
  });
});

describe('forget', () => {
  it('removes memories matching a query embedding', () => {
    const target = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
    const orthogonal = new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]);
    const memories = [
      { ...makeMemory({ id: 'm1', content: 'match' }), embedding: target },
      { ...makeMemory({ id: 'm2', content: 'unrelated' }), embedding: orthogonal },
    ];
    const { memories: result, forgotten } = forget(memories, target, 0.7);
    expect(forgotten).toBe(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m2');
  });
});

describe('consolidate (full pipeline)', () => {
  it('runs all phases without a summarizer', async () => {
    const memories = [
      makeOldMemory('old1', 'decaying memory', 10),
      ...makeDuplicatePair(),
    ];
    const { memories: result, report } = await consolidate(memories);

    expect(report.before.total).toBe(3);
    expect(report.decayed).toBeGreaterThanOrEqual(0);
    expect(report.deduplicated).toBe(1); // the duplicate pair
    expect(report.summarized).toBe(0);   // no summarizer
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.length).toBeLessThan(memories.length);
  });

  it('runs summarization with a summarizer', async () => {
    // Embeddings: similar enough to cluster (>0.78) but different enough to survive dedup (<0.92)
    const base = [0.8, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1];
    const makeEmb = (offsets: number[]): Float32Array => {
      const v = new Float32Array(base.map((x, i) => x + (offsets[i] || 0)));
      let n = 0;
      for (let i = 0; i < v.length; i++) n += v[i] * v[i];
      n = Math.sqrt(n);
      for (let i = 0; i < v.length; i++) v[i] /= n;
      return v;
    };

    const memories: Memory[] = [
      { ...makeMemory({ id: 'w1', content: 'Topic A detail one' }), embedding: makeEmb([0,0,0,0,0,0,0,0]), tier: 'warm' },
      { ...makeMemory({ id: 'w2', content: 'Topic A detail two' }), embedding: makeEmb([0,0.5,-0.3,0.2,0,0,0,0]), tier: 'warm' },
      { ...makeMemory({ id: 'w3', content: 'Topic A detail three' }), embedding: makeEmb([0,-0.2,0.4,0,0.3,0,0,0]), tier: 'warm' },
    ];

    const mockSummarizer: Summarizer = {
      summarize: async (texts) => `Summary of ${texts.length} memories`,
    };

    const { memories: result, report } = await consolidate(
      memories,
      { minClusterSize: 3 },
      mockSummarizer,
    );

    expect(report.clustersFound).toBe(1);
    expect(report.summarized).toBe(2); // 3 merged into 1 = 2 removed
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('Summary of 3');
    expect(result[0].tags).toContain('consolidated');
  });

  it('returns a valid report structure', async () => {
    const { report } = await consolidate([]);
    expect(report.timestamp).toBeDefined();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.before.total).toBe(0);
    expect(report.after.total).toBe(0);
  });
});
