export interface AstEdit {
  mode: 'ast';
  id?: string | null;
  action: 'replace' | 'insert' | 'remove' | 'rename';
  nodeType: string; // tree-sitter node type
  symbol?: string | null;
  newSymbol?: string | null;
  parentNodeType?: string | null;
  beforeSnippet?: string | null;
  afterSnippet?: string | null;
  insertSnippet?: string | null;
  reasoning: string;
  // from FileLocationSchema
  file: string;
  lines?: string | null;
}
