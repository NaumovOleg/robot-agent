import path from 'node:path';

export const detectLanguage = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();

  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.cs': 'csharp',
    '.php': 'php',
    '.cpp': 'cpp',
    '.c': 'c',
    '.swift': 'swift',
    '.dart': 'dart',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.env': 'bash',
    '.sh': 'bash',
    '.zsh': 'bash',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.prisma': 'prisma',
    '.proto': 'protobuf',
    '.xml': 'xml',
    '.svg': 'xml',
  };
  return langMap[ext] ?? 'text';
};

// Languages with a bundled tree-sitter wasm grammar (see packages/shared/src/ast/wasm).
// AST ops (replace_node, rename_symbol) require one; everything else must fall back
// to text ops. Keep in sync with the wasm/ directory.
const AST_WASM_LANGUAGES = new Set([
  'typescript', 'tsx', 'javascript', 'python', 'go', 'rust',
  'java', 'c', 'csharp', 'php', 'ruby', 'dart', 'json',
]);

export const isAstSupported = (filePath: string): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  const lang = ext === '.tsx' ? 'tsx' : detectLanguage(filePath);
  return AST_WASM_LANGUAGES.has(lang);
};
