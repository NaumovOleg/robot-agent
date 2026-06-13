import { SystemMessage } from '@langchain/core/messages';
import type { RootStateType } from '@robocode-packages/shared';
import { dedupeStepResults } from '../sub/executor';

// Converts executor results into a SystemMessage so the final agent node can
// compose the user-facing answer without knowing executor internals. A
// SystemMessage (rather than HumanMessage) keeps it out of the tool/AI chain the
// model treats as turns; like the context system prompt it is still persisted
// and rendered as a system notice on reload — acceptable, and consistent with
// the existing system-message handling.
export const executorReportNode = (state: RootStateType) => {
  const { stepResults, plan } = state;
  if (!plan || stepResults.length === 0) return {};

  const results = dedupeStepResults(stepResults);
  const lines = results.map((r) => {
    const step = plan.steps.find((s) => s.id === r.stepId);
    return `- [${r.status}] ${step?.title ?? r.stepId}${r.retries ? ` (retries: ${r.retries})` : ''}: ${r.output}`;
  });

  const report =
    `[executor report — internal]\nPlan: ${plan.goal}\nStep results:\n${lines.join('\n')}\n\n` +
    `Summarize what was done for the user. Mention failed or skipped steps explicitly. Do not re-apply any edits.`;

  return { messages: [new SystemMessage(report)] };
};
