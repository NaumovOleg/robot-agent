export interface PatchOperation {
  old_str: string;
  new_str: string;
}

export interface AppliedPatch {
  index: number;
  matchIndex: number;
  before: string;
  after: string;
  contentBefore: string;
}

export const applyPatchOperations = (
  content: string,
  patches: PatchOperation[]
): { content: string; applied: AppliedPatch[]; error?: string } => {
  let nextContent = content;
  const applied: AppliedPatch[] = [];

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const matchIndex = nextContent.indexOf(patch.old_str);

    if (matchIndex === -1) {
      return {
        content: nextContent,
        applied,
        error: `old_str not found for patch ${i + 1}`,
      };
    }

    const secondMatch = nextContent.indexOf(patch.old_str, matchIndex + 1);
    if (secondMatch !== -1) {
      return {
        content: nextContent,
        applied,
        error: `old_str appears multiple times for patch ${i + 1}`,
      };
    }

    const before = nextContent.slice(matchIndex, matchIndex + patch.old_str.length);
    const contentBefore = nextContent;
    nextContent =
      nextContent.slice(0, matchIndex) +
      patch.new_str +
      nextContent.slice(matchIndex + patch.old_str.length);

    applied.push({
      index: i,
      matchIndex,
      before,
      after: patch.new_str,
      contentBefore,
    });
  }

  return { content: nextContent, applied };
};
