import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';
import { plannerGraph } from '../../graphs/planner';

export const plannerNode = async (state: RootStateType) => {
  const { context, router, sessionId, answer } = state;
  if (!router.intent) return {};

  // same pattern as routerIntentNode:
  // collect all human requests — original + any clarification answers
  const requests = router.intent.resolvedRequest;

  // if user just answered a clarification question, that answer is
  // already appended to router.userRequests via preRoute
  debug('[plannerNode] invoking plannerGraph with', requests.length, 'requests');

  const result = await plannerGraph.invoke({
    requests,
    context,
    intent: router.intent,
    selectedFiles: state.selectedFiles ?? [],
    sessionId,
  });

  const plan = result.plan;
  if (!plan) return {};

  debug('[plannerNode] plan resolved', plan);
  EventBus.emit('agent:pending-plan', { sessionId, plan });

  // needs clarification → route to ask_user
  if (plan.clarifying_questions && plan.clarifying_questions.length > 0) {
    return { plan, clarificationSource: 'planner', question: plan.clarifying_questions[0] };
  }

  return { plan, clarificationSource: null, question: null };
};
