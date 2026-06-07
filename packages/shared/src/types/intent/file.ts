export interface FileLocation {
  file: string;
  lines?: string | null;
}

export interface TargetFile extends FileLocation {
  reason: string;
  snippet: string;
}

export interface FileEdit extends FileLocation {
  mode: 'file';
  id?: string | null;
  action: 'insert' | 'remove' | 'rename';
  target?: string | null;
  insertText?: string | null;
  reasoning: string;
}
