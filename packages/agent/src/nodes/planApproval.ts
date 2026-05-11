import type { AgentStateType } from '../state';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { HumanMessage } from '@langchain/core/messages';

export const planApprovalNode = async (state: AgentStateType) => {
  const { plan, sessionId } = state;
  if (!plan) return { planApproved: true };
  EventBus.emit('agent:plan_pending', { sessionId, plan });

  const decision = interrupt({ type: 'plan_approval', plan });
  const approved = decision === 'approve' || decision === 'y';
  EventBus.emit('agent:plan_decision', { sessionId, approved, plan });
  if (!approved) {
    const userRejectMessage = new HumanMessage({
      content: `User rejected the plan: ${JSON.stringify(plan)}`,
    });
    // Reset plan to null on rejection to trigger new planning
    return { planApproved: false, plan: null, messages: [userRejectMessage] };
  }

  return { planApproved: true, plan };
};
