import type { FileLocation } from './file';

export type TextAnchor =
  | { type: 'exact'; value: string; match?: 'unique' | 'nth'; occurrence?: number }
  | { type: 'contains'; value: string; match?: 'unique' | 'nth'; occurrence?: number };

export interface TextReplaceEdit extends FileLocation {
  mode: 'text';
  action: 'replace';
  id?: string | null;
  anchor: TextAnchor;
  replaceWith: string;
  before?: string | null;
  reasoning: string;
}

export interface TextInsertEdit extends FileLocation {
  mode: 'text';
  action: 'insert';
  id?: string | null;
  anchor: TextAnchor;
  insertMode: 'before' | 'after' | 'start' | 'end';
  insertText: string;
  reasoning: string;
}

export interface TextDeleteEdit extends FileLocation {
  mode: 'text';
  action: 'remove';
  id?: string | null;
  anchor: TextAnchor;
  target: string;
  reasoning: string;
}

export type TextEdit = TextReplaceEdit | TextInsertEdit | TextDeleteEdit;
