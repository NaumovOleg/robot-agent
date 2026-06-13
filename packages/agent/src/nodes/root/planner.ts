import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';
import { plannerGraph } from '../../graphs/planner';

export const plannerNode = async (state: RootStateType) => {
  const { context, router, sessionId } = state;
  if (!router.intent) return {};

  // same pattern as routerIntentNode:
  // collect all human requests — original + any clarification answers.
  // resolvedRequest is a single canonical string; plannerGraph expects string[].
  const requests = [router.intent.resolvedRequest];

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
  // NOTE: agent:pending-plan was a bogus event key (typo). Plan approval
  // emission now lives in planApprovalNode (agent:plan_pending).

  // needs clarification → route to ask_user
  if (plan.clarifying_questions && plan.clarifying_questions.length > 0) {
    return { plan, clarificationSource: 'planner', question: plan.clarifying_questions[0] };
  }

  return { plan, clarificationSource: null, question: null };
};
