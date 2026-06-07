export interface GrepResult {
  file: string;
  matchedKeywords: string[];
}

export function tfidfScore(
  result: GrepResult,
  allResults: GrepResult[],
  allFiles: string[],
  recentFiles: string[]
): number {
  const totalDocs = allFiles.length || 1;
  let score = 0;

  for (const kw of result.matchedKeywords) {
    const tf = result.matchedKeywords.filter((k) => k === kw).length;
    const docsWithKw = allResults.filter((r) => r.matchedKeywords.includes(kw)).length;
    const idf = Math.log((totalDocs + 1) / (docsWithKw + 1));
    score += tf * idf;
  }

  if (recentFiles.includes(result.file)) {
    score += 0.2;
  }

  return score;
}
