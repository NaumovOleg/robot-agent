import type { TargetFile } from './file';

export interface Anchor {
  type: 'exact' | 'contains';
  value: string;
  match?: 'unique' | 'nth';
  occurrence?: number;
}

export interface Edit {
  file: string;
  lines?: string | null;
  mode: 'text' | 'ast' | 'file';
  action: 'replace' | 'insert' | 'remove' | 'rename';
  id?: string | null;
  anchor?: Anchor | null; // text mode
  insertMode?: 'before' | 'after' | 'start' | 'end' | null;
  insertText?: string | null; // text/insert, file/insert
  replaceWith?: string | null; // text/replace
  before?: string | null; // text/replace (optional)
  target?: string | null; // text/remove, file/rename
  nodeType?: string | null; // ast mode
  symbol?: string | null; // ast mode
  newSymbol?: string | null; // ast/rename
  parentNodeType?: string | null; // ast mode
  existingNode?: string | null; // ast mode
  afterSnippet?: string | null; // ast/replace
  insertSnippet?: string | null; // ast/insert
  reasoning: string;
}

export interface Intent {
  summary: string;
  edits: Edit[];
  confidence: number;
}

export interface EditIntent {
  goal: string;
  summary: string;
  targetFiles: TargetFile[];
  constraints: string[];
  verification: string[];
  edits: Edit[];
  confidence: number;
}
