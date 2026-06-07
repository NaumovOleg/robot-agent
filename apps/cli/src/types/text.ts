export interface InlineChange {
  value: string;
  added?: boolean;
  removed?: boolean;
}
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNo?: number;
  newLineNo?: number;
  content: string;
  inlineChanges?: InlineChange[];
}
