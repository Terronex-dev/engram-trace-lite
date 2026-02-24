/**
 * Engram Trace Lite - Consolidation Engine
 *
 * Stateless, pure-function consolidation pipeline.
 * Takes memories in, returns consolidated memories + a report.
 * No timers, no background loops, no side effects.
 *
 * Pipeline phases (all run in sequence):
 *   1. Decay    - Age memories through tiers based on time + access patterns
 *   2. Dedup    - Remove near-identical memories (cosine similarity)
 *   3. Cluster  - Group similar WARM/COLD memories by embedding proximity
 *   4. Summarize - Collapse clusters into single entries (requires Summarizer)
 *   5. Archive  - Truncate old ARCHIVE-tier content to save space
 *
 * Phases 1, 2, and 5 are always available (zero dependencies).
 * Phases 3 and 4 require a Summarizer (any LLM).
 */

import type {
  Memory,
  MemoryTier,
  ConsolidateConfig,
  ConsolidationReport,
  Summarizer,
} from './types.js';

// -- Defaults -----------------------------------------------------------------

const DEFAULTS: Required<ConsolidateConfig> = {
  deduplicateThreshold: 0.92,
  clusterThreshold: 0.78,
  minClusterSize: 3,
  hotDays: 7,
  warmDays: 30,
  coldDays: 365,
  archiveTruncateLength: 200,
};

// -- Public API ---------------------------------------------------------------

/**
 * Run the full consolidation pipeline on a set of memories.
 *
 * This is a pure function: it does not mutate the input array.
 * Returns new memories and a detailed report.
 *
 * @example
 * ```ts
 * import { consolidate } from '@terronex/engram-trace-lite';
 *
 * // Without LLM (decay + dedup + archive only)
 * const { memories, report } = await consolidate(myMemories);
 *
 * // With LLM summarization
 * const { memories, report } = await consolidate(myMemories, {
 *   hotDays: 3,
 *   warmDays: 14,
 * }, mySummarizer);
 * ```
 */
export async function consolidate(
  memories: Memory[],
  config?: ConsolidateConfig,
  summarizer?: Summarizer,
): Promise<{ memories: Memory[]; report: ConsolidationReport }> {
  const cfg = { ...DEFAULTS, ...config };
  const start = Date.now();
  const before = countByTier(memories);

  let current = memories.map(m => ({ ...m })); // shallow clone

  // Phase 1: Decay
  const decayResult = decay(current, cfg);
  current = decayResult.memories;

  // Phase 2: Deduplicate
  const dedupResult = deduplicate(current, cfg.deduplicateThreshold);
  current = dedupResult.memories;

  // Phase 3 + 4: Cluster and Summarize (only with summarizer)
  let clustersFound = 0;
  let summarized = 0;
  if (summarizer) {
    const clusters = cluster(current, cfg);
    clustersFound = clusters.length;
    if (clusters.length > 0) {
      const sumResult = await summarizeClusters(current, clusters, summarizer);
      current = sumResult.memories;
      summarized = sumResult.merged;
    }
  }

  // Phase 5: Archive
  const archiveResult = archive(current, cfg.archiveTruncateLength);
  current = archiveResult.memories;

  const after = countByTier(current);

  return {
    memories: current,
    report: {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      before: { total: memories.length, byTier: before },
      after: { total: current.length, byTier: after },
      decayed: decayResult.changed,
      deduplicated: dedupResult.removed,
      clustersFound,
      summarized,
      archived: archiveResult.changed,
    },
  };
}

// -- Individual phases (exported for granular use) ----------------------------

/**
 * Run only the decay phase. Moves memories through tiers based on age.
 * Access frequency and importance slow decay.
 */
export function decay(
  memories: Memory[],
  config?: Pick<ConsolidateConfig, 'hotDays' | 'warmDays' | 'coldDays'>,
): { memories: Memory[]; changed: number } {
  const cfg = { ...DEFAULTS, ...config };
  const now = Date.now();
  let changed = 0;

  const updated = memories.map(m => {
    const ageMs = now - new Date(m.createdAt).getTime();
    const ageDays = ageMs / 86_400_000;

    // Frequent access slows decay (max 5 days boost per access)
    const accessBoost = Math.min(m.accessCount * 0.5, 5);
    // High importance memories decay slower (1x to 3x multiplier)
    const importanceMultiplier = 1 + (m.importance * 2);
    const effectiveAge = (ageDays - accessBoost) / importanceMultiplier;

    let newTier: MemoryTier = m.tier;
    if (m.tier === 'hot' && effectiveAge > cfg.hotDays!) newTier = 'warm';
    else if (m.tier === 'warm' && effectiveAge > cfg.warmDays!) newTier = 'cold';
    else if (m.tier === 'cold' && effectiveAge > cfg.coldDays!) newTier = 'archive';

    if (newTier !== m.tier) {
      changed++;
      return { ...m, tier: newTier };
    }
    return m;
  });

  return { memories: updated, changed };
}

/**
 * Remove near-duplicate memories based on embedding cosine similarity.
 * Keeps the memory with higher importance + access score.
 */
export function deduplicate(
  memories: Memory[],
  threshold = 0.92,
): { memories: Memory[]; removed: number } {
  if (memories.length < 2) return { memories, removed: 0 };

  const remove = new Set<number>();

  for (let i = 0; i < memories.length; i++) {
    if (remove.has(i)) continue;
    for (let j = i + 1; j < memories.length; j++) {
      if (remove.has(j)) continue;
      const sim = cosineSimilarity(memories[i].embedding, memories[j].embedding);
      if (sim > threshold) {
        const scoreI = memories[i].importance + memories[i].accessCount * 0.1;
        const scoreJ = memories[j].importance + memories[j].accessCount * 0.1;
        if (scoreI >= scoreJ) {
          remove.add(j);
        } else {
          remove.add(i);
          break;
        }
      }
    }
  }

  return {
    memories: memories.filter((_, i) => !remove.has(i)),
    removed: remove.size,
  };
}

/**
 * Find clusters of similar WARM/COLD memories.
 * Returns arrays of indices into the memories array.
 */
export function cluster(
  memories: Memory[],
  config?: Pick<ConsolidateConfig, 'clusterThreshold' | 'minClusterSize'>,
): number[][] {
  const cfg = { ...DEFAULTS, ...config };
  const candidates = memories
    .map((m, i) => ({ m, i }))
    .filter(c => c.m.tier === 'warm' || c.m.tier === 'cold');

  if (candidates.length < cfg.minClusterSize!) return [];

  const assigned = new Set<number>();
  const clusters: number[][] = [];

  for (const { m: seed, i: seedIdx } of candidates) {
    if (assigned.has(seedIdx)) continue;
    const group = [seedIdx];
    assigned.add(seedIdx);

    for (const { m: other, i: otherIdx } of candidates) {
      if (assigned.has(otherIdx)) continue;
      if (cosineSimilarity(seed.embedding, other.embedding) >= cfg.clusterThreshold!) {
        group.push(otherIdx);
        assigned.add(otherIdx);
      }
    }

    if (group.length >= cfg.minClusterSize!) {
      clusters.push(group);
    } else {
      for (const idx of group) assigned.delete(idx);
    }
  }

  return clusters;
}

/**
 * Forget memories matching a semantic query.
 * Returns memories that did NOT match (i.e., the survivors).
 */
export function forget(
  memories: Memory[],
  queryEmbedding: Float32Array,
  threshold = 0.7,
): { memories: Memory[]; forgotten: number } {
  const survivors = memories.filter(
    m => cosineSimilarity(m.embedding, queryEmbedding) < threshold,
  );
  return { memories: survivors, forgotten: memories.length - survivors.length };
}

// -- Internal -----------------------------------------------------------------

async function summarizeClusters(
  memories: Memory[],
  clusters: number[][],
  summarizer: Summarizer,
): Promise<{ memories: Memory[]; merged: number }> {
  const result = [...memories];
  const toRemove = new Set<number>();
  let totalMerged = 0;

  for (const group of clusters) {
    const texts = group.map(i => memories[i].content);
    try {
      const summary = await summarizer.summarize(texts);
      if (!summary || summary.length < 10) continue;

      // Keep the highest-scored memory, update its content
      const best = group.reduce((a, b) => {
        const sa = memories[a].importance + memories[a].accessCount * 0.1;
        const sb = memories[b].importance + memories[b].accessCount * 0.1;
        return sa >= sb ? a : b;
      });

      for (const idx of group) {
        if (idx !== best) toRemove.add(idx);
      }

      const bestInResult = result.findIndex(m => m.id === memories[best].id);
      if (bestInResult !== -1) {
        result[bestInResult] = {
          ...result[bestInResult],
          content: summary,
          tags: [...new Set([...result[bestInResult].tags, 'consolidated'])],
          importance: Math.max(...group.map(i => memories[i].importance)),
          metadata: {
            ...result[bestInResult].metadata,
            consolidatedFrom: group.length,
            consolidatedAt: new Date().toISOString(),
          },
        };
      }

      totalMerged += group.length - 1;
    } catch {
      continue; // LLM failure is non-fatal
    }
  }

  return {
    memories: result.filter((_, i) => !toRemove.has(i)),
    merged: totalMerged,
  };
}

function archive(
  memories: Memory[],
  truncateLength: number,
): { memories: Memory[]; changed: number } {
  if (truncateLength <= 0) return { memories, changed: 0 };
  let changed = 0;

  const updated = memories.map(m => {
    if (
      m.tier === 'archive' &&
      m.content.length > truncateLength &&
      !m.tags.includes('consolidated')
    ) {
      changed++;
      return {
        ...m,
        content: m.content.slice(0, truncateLength) + '...',
        metadata: { ...m.metadata, truncated: true, originalLength: m.content.length },
      };
    }
    return m;
  });

  return { memories: updated, changed };
}

// -- Math ---------------------------------------------------------------------

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function countByTier(memories: Memory[]): Record<MemoryTier, number> {
  const c: Record<MemoryTier, number> = { hot: 0, warm: 0, cold: 0, archive: 0 };
  for (const m of memories) c[m.tier] = (c[m.tier] || 0) + 1;
  return c;
}
