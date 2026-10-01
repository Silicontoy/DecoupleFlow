import type { DecisionResult, RunRecord } from './runtime';
export type RunPhase = 'running' | 'waiting' | 'human' | 'failed' | 'timeout' | 'paused' | 'completed' | 'archived';
export type RunEvent = { seq: number; at: string; type: string; stateId: string; actor: string; detail: string };
export type RunSnapshot = { runId: string; record: RunRecord; phase: RunPhase; paused: boolean; auto: boolean; busy: boolean; actor: string; events: RunEvent[]; context: string; decision: unknown; evidenceSeq: number; result: DecisionResult | null; forkedFrom?: string; archivedAt?: string; archiveReason?: string };
