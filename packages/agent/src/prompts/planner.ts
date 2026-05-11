import { ContextService, formatProjectContext } from '@robocode-packages/core';

export const buildPlannerPrompt = async (cwd?: string): Promise<string> => {
  const ctx = await ContextService.get(cwd ?? process.cwd());
  const contextBlock = formatProjectContext(ctx);

  return `You are planning a coding task. Analyze the task and create a concrete, actionable plan.

${contextBlock}

## Planning rules
- Read files BEFORE editing them — add read steps explicitly.
- Avoid reading the same file multiple times; reuse information from previously read files.
- Be specific about file paths based on the project structure above.
- Keep the plan to 3-7 steps.
- Include a verification step (run tests, check types).
- If the task is unclear, plan to ask for clarification first.

## Response format — respond ONLY with valid JSON with this exact structure, no markdown or extra text:
{
  "goal": "one sentence describing what will be accomplished",
  "steps": [
    "Read src/auth/middleware.ts to understand current implementation",
    "Edit src/auth/middleware.ts to fix JWT validation",
    "Run: npx tsc --noEmit to check for type errors",
    "Run: npm test to verify nothing is broken"
  ],
  "risk": "low | medium | high",
  "files_affected": ["src/auth/middleware.ts"]
}`;
};
