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
