import type { TextReplaceEdit, TextInsertEdit, TextDeleteEdit } from '../../types';

type TextAnchor = TextReplaceEdit['anchor'];

interface TextRange {
  start: number;
  end: number;
}

const collectMatches = (content: string, needle: string): TextRange[] => {
  const matches: TextRange[] = [];
  let offset = 0;

  while (offset <= content.length) {
    const start = content.indexOf(needle, offset);
    if (start === -1) break;

    const end = start + needle.length;
    matches.push({ start, end });
    offset = end;
  }

  return matches;
};

const resolveMatch = (content: string, needle: string, label: string, anchor?: TextAnchor): TextRange => {
  const matches = collectMatches(content, needle);
  if (matches.length === 0) throw new Error(`[${label}] Target not found: "${needle}"`);

  const matchMode = anchor?.match ?? 'unique';
  const occurrence = anchor?.occurrence ?? 1;

  if (matchMode === 'unique') {
    if (matches.length !== 1) {
      throw new Error(`[${label}] Expected unique target but found ${matches.length} matches: "${needle}"`);
    }

    return matches[0];
  }

  const match = matches[occurrence - 1];
  if (!match) {
    throw new Error(`[${label}] Occurrence ${occurrence} not found for target: "${needle}"`);
  }

  return match;
};

export const applyTextReplace = (content: string, edit: TextReplaceEdit): string => {
  const { anchor, replaceWith, before } = edit;
  const needle = before ?? anchor.value;
  const range = resolveMatch(content, needle, 'text/replace', anchor);

  if (before && !before.includes(anchor.value)) {
    throw new Error('[text/replace] before must include anchor.value');
  }

  return content.slice(0, range.start) + replaceWith + content.slice(range.end);
};

export const applyTextInsert = (content: string, edit: TextInsertEdit): string => {
  const { anchor, insertText, insertMode } = edit;

  if (insertMode === 'start') return insertText + content;
  if (insertMode === 'end') return content + insertText;
  if (!anchor) {
    throw new Error('[text/insert] anchor is required for insertMode "before" and "after"');
  }

  const range = resolveMatch(content, anchor.value, 'text/insert', anchor);

  if (insertMode === 'before') {
    return content.slice(0, range.start) + insertText + content.slice(range.start);
  }

  return content.slice(0, range.end) + insertText + content.slice(range.end);
};

export const applyTextDelete = (content: string, edit: TextDeleteEdit): string => {
  const { anchor, target } = edit;
  const needle = target ?? anchor.value;

  if (!needle.includes(anchor.value)) {
    throw new Error('[text/delete] target must include anchor.value');
  }

  const range = resolveMatch(content, needle, 'text/delete', anchor);
  return content.slice(0, range.start) + content.slice(range.end);
};
