import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Parser } from 'web-tree-sitter';
import type {
  AstEdit,
  Edit,
  FileEdit,
  Intent,
  TextDeleteEdit,
  TextInsertEdit,
  TextReplaceEdit,
} from '../../types';
import {
  applyTextDelete,
  applyTextInsert,
  applyTextReplace,
} from './textOps';
import {
  applyAstInsert,
  applyAstRemove,
  applyAstRename,
  applyAstReplace,
} from './astOps';
import {
  applyFileInsert,
  applyFileRemove,
  applyFileRename,
} from './fileOps';

export interface WriteResult {
  file: string;
  id?: string | null;
  status: 'ok' | 'error';
  error?: string;
}

const applyContentEdit = (content: string, edit: Edit, parser: Parser): string => {
  if (edit.mode === 'text') {
    switch (edit.action) {
      case 'replace':
        return applyTextReplace(content, edit as TextReplaceEdit);
      case 'insert':
        return applyTextInsert(content, edit as TextInsertEdit);
      case 'remove':
        return applyTextDelete(content, edit as TextDeleteEdit);
    }
  }

  if (edit.mode === 'ast') {
    const tree = parser.parse(content);
    if (!tree) {
      throw new Error('Unknown node tree');
    }

    switch (edit.action) {
      case 'rename':
        return applyAstRename(content, edit as AstEdit, tree);
      case 'replace':
        return applyAstReplace(content, edit as AstEdit, tree);
      case 'remove':
        return applyAstRemove(content, edit as AstEdit, tree);
      case 'insert':
        return applyAstInsert(content, edit as AstEdit);
    }
  }

  throw new Error(`Unknown edit mode/action: ${edit.mode}/${edit.action}`);
};

const resolveFilePath = (repoRoot: string, file: string): string => {
  const root = path.resolve(repoRoot);
  const absPath = path.resolve(root, file);
  const relative = path.relative(root, absPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }

  return absPath;
};

const isCreateLikeTextInsert = (edit: Edit): boolean => {
  if (edit.mode !== 'text' || edit.action !== 'insert') return false;
  const insertMode = edit.insertMode;
  if (insertMode !== 'start' && insertMode !== 'end') return false;

  const anchor = (edit as { anchor?: unknown | null }).anchor;
  return anchor == null;
};

const readFileContent = async (absPath: string): Promise<string> => {
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`File not found: ${absPath}`);
  }
};

const applyFileEdit = async (
  intentEdit: FileEdit,
  repoRoot: string,
  contentCache: Map<string, string>
): Promise<void> => {
  switch (intentEdit.action) {
    case 'insert': {
      const { absPath, content } = await applyFileInsert(repoRoot, intentEdit);
      contentCache.set(absPath, content);
      return;
    }
    case 'remove': {
      const { absPath } = await applyFileRemove(repoRoot, intentEdit);
      contentCache.delete(absPath);
      return;
    }
    case 'rename': {
      const { absPath, targetAbsPath } = await applyFileRename(repoRoot, intentEdit);
      if (contentCache.has(absPath)) {
        const content = contentCache.get(absPath);
        contentCache.delete(absPath);
        if (content !== undefined) {
          contentCache.set(targetAbsPath, content);
        }
      }
      return;
    }
    default:
      throw new Error(`Unknown file action: ${intentEdit.action}`);
  }
};

export const applyEditIntent = async (
  intent: Intent,
  parser: Parser,
  repoRoot: string
): Promise<WriteResult[]> => {
  const contentCache = new Map<string, string>();
  const results: WriteResult[] = [];

  for (const edit of intent.edits) {
    try {
      if (edit.mode === 'file') {
        await applyFileEdit(edit as FileEdit, repoRoot, contentCache);
        results.push({ file: edit.file, id: edit.id, status: 'ok' });
        continue;
      }

      const absPath = resolveFilePath(repoRoot, edit.file);
      const cachedContent = contentCache.get(absPath);
      let currentContent: string;

      if (cachedContent !== undefined) {
        currentContent = cachedContent;
      } else {
        try {
          currentContent = await readFileContent(absPath);
        } catch (error) {
          if (isCreateLikeTextInsert(edit)) {
            const insertText = edit.insertText ?? '';
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            await fs.writeFile(absPath, insertText, 'utf-8');
            contentCache.set(absPath, insertText);
            results.push({ file: edit.file, id: edit.id, status: 'ok' });
            continue;
          }
          throw error;
        }
      }

      const nextContent = applyContentEdit(currentContent, edit, parser);

      await fs.writeFile(absPath, nextContent, 'utf-8');
      contentCache.set(absPath, nextContent);
      results.push({ file: edit.file, id: edit.id, status: 'ok' });
    } catch (error) {
      results.push({ file: edit.file, id: edit.id, status: 'error', error: String(error) });
    }
  }

  return results;
};
