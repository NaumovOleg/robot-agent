import type { FileSelectorStateType } from '@robocode-packages/shared';
import { createBaseModel } from '../../utils/model';
import { z } from 'zod';

const KeywordsSchema = z.object({
  keywords: z.array(z.string()).describe('Search terms to find relevant files'),
});

export const extractKeywordsNode = async (state: FileSelectorStateType) => {
  if (state.keywords.length > 0) return { keywords: state.keywords };

  const llm = createBaseModel(false).withStructuredOutput(KeywordsSchema);

  const prompt = `Extract search terms to find relevant source files for this task.
Return function names, class names, file name fragments, import paths, config keys, and error strings.
Task: ${state.goal}`;

  try {
    const result = await llm.invoke(prompt);
    return { keywords: result.keywords };
  } catch {
    // fallback to simple split on LLM failure
    const keywords = state.goal
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return { keywords };
  }
};
