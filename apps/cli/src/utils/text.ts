import * as Diff from 'diff';
import type { InlineChange, DiffLine } from '@types';

export const splitLines = (str: string): string[] => str.replace(/\r\n/g, '\n').split('\n');

export const truncate = (text: string, maxWidth: number, suffix = '…'): string => {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - suffix.length) + suffix;
};

export const computeInlineChanges = (oldLine: string, newLine: string): InlineChange[] => {
  const changes = Diff.diffChars(oldLine, newLine);
  return changes.map((change) => ({
    value: change.value,
    added: change.added,
    removed: change.removed,
  }));
};

export const buildDetailedRows = (oldLines: string[], newLines: string[], startLine = 1): DiffLine[] => {
  const rows: DiffLine[] = [];
  let oldIdx = 0,
    newIdx = 0;
  let oldLineNo = startLine,
    newLineNo = startLine;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldIdx >= oldLines.length) {
      rows.push({
        type: 'add',
        newLineNo: newLineNo++,
        content: newLine,
        inlineChanges: computeInlineChanges('', newLine),
      });
      newIdx++;
      continue;
    }

    if (newIdx >= newLines.length) {
      rows.push({
        type: 'remove',
        oldLineNo: oldLineNo++,
        content: oldLine,
        inlineChanges: computeInlineChanges(oldLine, ''),
      });
      oldIdx++;
      continue;
    }

    if (oldLine === newLine) {
      rows.push({
        type: 'context',
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
        content: oldLine,
      });
      oldIdx++;
      newIdx++;
      continue;
    }

    if (oldLines[oldIdx + 1] === newLine) {
      rows.push({
        type: 'remove',
        oldLineNo: oldLineNo++,
        content: oldLine,
        inlineChanges: computeInlineChanges(oldLine, ''),
      });
      oldIdx++;
      continue;
    }

    if (oldLine === newLines[newIdx + 1]) {
      rows.push({
        type: 'add',
        newLineNo: newLineNo++,
        content: newLine,
        inlineChanges: computeInlineChanges('', newLine),
      });
      newIdx++;
      continue;
    }

    rows.push({
      type: 'remove',
      oldLineNo: oldLineNo++,
      content: oldLine,
      inlineChanges: computeInlineChanges(oldLine, newLine),
    });
    rows.push({
      type: 'add',
      newLineNo: newLineNo++,
      content: newLine,
      inlineChanges: computeInlineChanges(oldLine, newLine),
    });
    oldIdx++;
    newIdx++;
  }

  return rows;
};

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
