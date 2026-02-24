/**
 * Engram Trace Lite - Type Definitions
 *
 * Minimal types for stateless memory consolidation.
 * Unlike full Trace, there is no agent loop, no auto-remember,
 * and no background timers. Consolidation is triggered explicitly.
 */

// -- Tiers --------------------------------------------------------------------

export type MemoryTier = 'hot' | 'warm' | 'cold' | 'archive';

// -- Memory -------------------------------------------------------------------

/**
 * A single memory entry. Compatible with @terronex/engram MemoryNode
 * but uses a flat structure for simplicity.
 */
export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array;
  tags: string[];
  importance: number;
  tier: MemoryTier;
  createdAt: string;        // ISO 8601
  lastAccessed: string;     // ISO 8601
  accessCount: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

// -- Config -------------------------------------------------------------------

/**
 * Consolidation configuration. Every field has a sensible default.
 */
export interface ConsolidateConfig {
  /** Cosine threshold for deduplication (0-1). Default: 0.92 */
  deduplicateThreshold?: number;

  /** Cosine threshold for clustering related memories. Default: 0.78 */
  clusterThreshold?: number;

  /** Minimum cluster size before summarization kicks in. Default: 3 */
  minClusterSize?: number;

  /** Days before HOT decays to WARM. Default: 7 */
  hotDays?: number;

  /** Days before WARM decays to COLD. Default: 30 */
  warmDays?: number;

  /** Days before COLD decays to ARCHIVE. Default: 365 */
  coldDays?: number;

  /** Truncate ARCHIVE content to this many characters. 0 = no truncation. Default: 200 */
  archiveTruncateLength?: number;
}

// -- Summarizer ---------------------------------------------------------------

/**
 * Optional LLM interface for cluster summarization.
 * Without this, consolidation still runs decay + dedup + archive
 * but skips the summarization phase.
 */
export interface Summarizer {
  summarize(texts: string[]): Promise<string>;
}

// -- Report -------------------------------------------------------------------

/**
 * Returned after every consolidation run.
 * Provides full before/after transparency.
 */
export interface ConsolidationReport {
  timestamp: string;
  durationMs: number;
  before: { total: number; byTier: Record<MemoryTier, number> };
  after: { total: number; byTier: Record<MemoryTier, number> };
  decayed: number;
  deduplicated: number;
  clustersFound: number;
  summarized: number;
  archived: number;
}
