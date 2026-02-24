/**
 * Engram Trace Lite
 *
 * Lightweight, stateless memory consolidation for the Engram ecosystem.
 * Designed for applications that manage their own memory lifecycle
 * (like Allo) rather than running an autonomous agent loop (like Rex).
 *
 * @packageDocumentation
 */

export {
  consolidate,
  decay,
  deduplicate,
  cluster,
  forget,
  cosineSimilarity,
} from './consolidator.js';

export type {
  Memory,
  MemoryTier,
  ConsolidateConfig,
  ConsolidationReport,
  Summarizer,
} from './types.js';
