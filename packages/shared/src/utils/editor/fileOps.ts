import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileEdit } from '../../types';

const resolveFilePath = (repoRoot: string, file: string): string => {
  const root = path.resolve(repoRoot);
  const absPath = path.resolve(root, file);
  const relative = path.relative(root, absPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }

  return absPath;
};

const fileExists = async (absPath: string): Promise<boolean> => {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
};

export interface FileInsertResult {
  absPath: string;
  content: string;
}

export interface FileRemoveResult {
  absPath: string;
}

export interface FileRenameResult {
  absPath: string;
  targetAbsPath: string;
}

export const applyFileInsert = async (
  repoRoot: string,
  edit: FileEdit
): Promise<FileInsertResult> => {
  const absPath = resolveFilePath(repoRoot, edit.file);
  const content = edit.insertText;

  if (content == null) {
    throw new Error('[file/insert] insertText is required');
  }

  if (await fileExists(absPath)) {
    throw new Error(`[file/insert] File already exists: "${edit.file}"`);
  }

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');

  return { absPath, content };
};

export const applyFileRemove = async (
  repoRoot: string,
  edit: FileEdit
): Promise<FileRemoveResult> => {
  const absPath = resolveFilePath(repoRoot, edit.file);

  if (!(await fileExists(absPath))) {
    throw new Error(`[file/remove] File not found: "${edit.file}"`);
  }

  await fs.unlink(absPath);
  return { absPath };
};

export const applyFileRename = async (
  repoRoot: string,
  edit: FileEdit
): Promise<FileRenameResult> => {
  const absPath = resolveFilePath(repoRoot, edit.file);
  const target = edit.target ?? '';

  if (!target) {
    throw new Error('[file/rename] target is required');
  }

  const targetAbsPath = resolveFilePath(repoRoot, target);

  if (absPath === targetAbsPath) {
    return { absPath, targetAbsPath };
  }

  if (!(await fileExists(absPath))) {
    throw new Error(`[file/rename] File not found: "${edit.file}"`);
  }

  if (await fileExists(targetAbsPath)) {
    throw new Error(`[file/rename] Target already exists: "${target}"`);
  }

  await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
  await fs.rename(absPath, targetAbsPath);

  return { absPath, targetAbsPath };
};
