import { tfidfScore } from '../../packages/agent/src/context/file_selector/score';

test('scores file higher when more unique keywords match', () => {
  const grepResults = [
    { file: 'src/auth.ts', matchedKeywords: ['login', 'token', 'session'] },
    { file: 'src/utils.ts', matchedKeywords: ['token'] },
  ];
  const allFiles = grepResults.map((r) => r.file);
  const scores = grepResults.map((r) => tfidfScore(r, grepResults, allFiles, []));
  expect(scores[0]).toBeGreaterThan(scores[1]);
});

test('recency bonus applied for recently changed files', () => {
  const grepResults = [
    { file: 'src/a.ts', matchedKeywords: ['foo'] },
    { file: 'src/b.ts', matchedKeywords: ['foo'] },
  ];
  const allFiles = grepResults.map((r) => r.file);
  const recentFiles = ['src/a.ts'];
  const scoreA = tfidfScore(grepResults[0], grepResults, allFiles, recentFiles);
  const scoreB = tfidfScore(grepResults[1], grepResults, allFiles, recentFiles);
  expect(scoreA).toBeGreaterThan(scoreB);
});
