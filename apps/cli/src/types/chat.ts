// apps/cli/src/types/chat.ts

export interface ToolStreamChunk {
  kind: 'stdout' | 'stderr';
  text: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  output?: string;
  error?: string;
  stream?: ToolStreamChunk[];
  startedAt?: number;
  finishedAt?: number;
  children?: ToolActivity[];
}

export interface TurnSummaryData {
  groups: Array<{ verb: string; count: number }>;
  durationSec: number;
  timestamp: number;
  hasError: boolean;
  tokens: number;   // turn-level token count (0 if not tracked)
  cost: number;     // turn-level cost USD (0 if not tracked)
}

export type StaticItem =
  | { kind: 'human';        id: string; content: string }
  | { kind: 'ai';           id: string; content: string }
  | { kind: 'system';       id: string; content: string }
  | { kind: 'turn-summary'; id: string; data: TurnSummaryData }
  | { kind: 'thinking';     id: string; text: string };

export interface Message {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string;
}
