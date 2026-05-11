import { CONTEXT_LINES } from '@robocode-packages/config';

export const getLineContext = (
  content: string,
  matchIndex: number,
  matchLength: number
): { before: string; after: string; lineNumber: number } => {
  const lines = content.split('\n');
  let charCount = 0;
  let matchLine = 0;

  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= matchIndex) {
      matchLine = i;
      break;
    }
    charCount += lines[i].length + 1;
  }

  const start = Math.max(0, matchLine - CONTEXT_LINES);
  const end = Math.min(lines.length, matchLine + CONTEXT_LINES + matchLength);

  const before = lines
    .slice(start, matchLine)
    .map((l, i) => `  ${start + i + 1} | ${l}`)
    .join('\n');

  const after = lines
    .slice(matchLine + 1, end)
    .map((l, i) => `  ${matchLine + i + 2} | ${l}`)
    .join('\n');

  return { before, after, lineNumber: matchLine + 1 };
};
