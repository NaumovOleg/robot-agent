import { getLineContext } from './lineContext';

export const buildDiff = (
  filePath: string,
  oldStr: string,
  newStr: string,
  content: string,
  matchIndex: number
): string => {
  const { before, after, lineNumber } = getLineContext(
    content,
    matchIndex,
    oldStr.split('\n').length
  );

  const removed = oldStr
    .split('\n')
    .map((l) => `- ${l}`)
    .join('\n');
  const added = newStr
    .split('\n')
    .map((l) => `+ ${l}`)
    .join('\n');

  return [`--- ${filePath} (line ${lineNumber})`, before, removed, added, after]
    .filter(Boolean)
    .join('\n');
};
