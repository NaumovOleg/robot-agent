export interface StepReviewPromptInput {
  stepTitle: string;
  expectedOutput: string;
  appliedOps: string[];
  verifyOutput: string | null;
}

export const buildStepReviewPrompt = (input: StepReviewPromptInput): string => `You are the reviewer inside a code-editing loop. One plan step was just executed and verified. Decide if its result satisfies the expected output.

## Step
${input.stepTitle}

## Expected output (success criteria)
${input.expectedOutput}

## Operations applied
${input.appliedOps.map((op) => `- ${op}`).join('\n') || '- none'}

## Verification output (type check / tests)
${input.verifyOutput ?? '(no verification was configured — judge from the applied operations alone)'}

## Verdict rules
- "sufficient": the applied operations plausibly satisfy the expected output and verification did not fail.
- "insufficient": something is missing or wrong but a corrected attempt could fix it. Explain exactly what to change.
- "blocked": the step cannot succeed without human input (wrong plan assumption, missing file, contradictory constraints).
Keep "reason" short, concrete, and actionable — it is fed back into the next attempt.`;
