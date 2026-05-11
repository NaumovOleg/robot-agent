import type { DirEntry } from '../types';
import fs from 'node:fs';
import path from 'node:path';
import { IGNORE_DIRS } from '@robocode-packages/config';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

export const formatSize = (bytes: number): string => {
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < SIZE_UNITS.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)}${SIZE_UNITS[i]}`;
};

export const formatDate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

export const readDir = (dirPath: string, depth: number, maxDepth: number): DirEntry[] => {
  if (depth > maxDepth) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        return null;
      }

      const entryType = entry.isDirectory() ? 'dir' : 'file';

      const base: DirEntry = {
        name: entry.name,
        type: entry.isSymbolicLink() ? 'symlink' : entryType,
        size: stat.size,
        modified: formatDate(stat.mtime),
      };

      if (entry.isDirectory() && depth < maxDepth) {
        base.children = readDir(fullPath, depth + 1, maxDepth);
      }

      return base;
    })
    .filter((el) => !!el);
};

export const renderTree = (entries: DirEntry[], prefix = '', isRoot = false): string => {
  const lines: string[] = [];

  entries.forEach((entry, i) => {
    const isLast = i === entries.length - 1;
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';
    const childPrefix = isRoot ? '' : isLast ? '    ' : '│   ';

    const icon = entry.type === 'dir' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄';
    const sizeStr = entry.type === 'file' ? ` (${formatSize(entry.size)})` : '';
    const dateStr = ` [${entry.modified}]`;

    lines.push(`${prefix}${connector}${icon} ${entry.name}${sizeStr}${dateStr}`);

    if (entry.children?.length) {
      lines.push(renderTree(entry.children, prefix + childPrefix));
    }
  });

  return lines.join('\n');
};

export const renderFlat = (entries: DirEntry[], basePath: string, currentPath = ''): string => {
  const lines: string[] = [];

  for (const entry of entries) {
    const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

    if (entry.type === 'file') {
      lines.push(`${entryPath} (${formatSize(entry.size)}) [${entry.modified}]`);
    } else if (entry.type === 'dir') {
      lines.push(`${entryPath}/`);
      if (entry.children?.length) {
        lines.push(renderFlat(entry.children, basePath, entryPath));
      }
    }
  }

  return lines.join('\n');
};

export const formatLines = (lines: string[], startLine: number): string => {
  const padWidth = String(startLine + lines.length).length;
  return lines
    .map((line, i) => `${String(startLine + i).padStart(padWidth, ' ')} | ${line}`)
    .join('\n');
};

export const getFileStats = (lines: string[]): string => {
  const totalLines = lines.length;
  const totalChars = lines.reduce((acc, l) => acc + l.length, 0);
  const avgLineLength = Math.round(totalChars / totalLines);
  return `${totalLines} lines, ~${avgLineLength} chars/line`;
};
