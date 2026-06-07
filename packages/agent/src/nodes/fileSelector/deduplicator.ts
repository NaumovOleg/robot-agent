import type { FileSelectorStateType } from '@robocode-packages/shared';

export const selectTopKNode = async (state: FileSelectorStateType) => {
  const unique = new Map<string, number>();

  for (const f of state.scoredFiles) {
    unique.set(f.file, Math.max(unique.get(f.file) ?? 0, f.score));
  }

  const sorted = Array.from(unique.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file]) => file);

  return { selectedFiles: sorted };
};
