import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';
import type { PlannerOutput } from '@robocode-packages/shared';

const formatPlan = (plan: PlannerOutput): string => {
  const steps = plan.steps
    .map((s, i) => `${i + 1}. [${s.kind}] ${s.title} (${s.files.join(', ') || 'no files'})`)
    .join('\n');
  return `${plan.goal}\n\nRisk: ${plan.risk}\nSteps:\n${steps}`;
};

// The CLI already renders agent:plan_pending as an approve/reject prompt and
// answers via agent:resume → Command({ resume: decision }). This node closes
// that loop with an actual interrupt.
export const planApprovalNode = (state: RootStateType) => {
  const { sessionId, plan } = state;
  if (!plan) return { planApproved: false };

  const formatted = formatPlan(plan);
  EventBus.emit('agent:plan_pending', { sessionId, plan: formatted });

  const decision: string = interrupt(formatted);
  const approved = decision === 'approve' || decision === 'y';

  EventBus.emit('agent:plan_decision', { sessionId, approved, plan: formatted });
  debug('[planApprovalNode]', approved ? 'approved' : 'rejected');
  return { planApproved: approved };
};
