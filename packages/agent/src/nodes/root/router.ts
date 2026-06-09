import type { RootStateType } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';
import { routerGraph } from '../../graphs/router';

export const routerIntentNode = async (state: RootStateType): Promise<Partial<RootStateType>> => {
  const {
    context,
    sessionId,
    router: { userRequests },
  } = state;

  const result = await routerGraph.invoke({
    requests: userRequests,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    context: context!,
    sessionId,
  });

  const intent = result.intent;
  if (!intent) return {};

  debug('[routerIntentNode] intent resolved', intent);

  const router = { intent, userRequests: result.requests };

  if (intent.needsClarification && intent.question) {
    return {
      router,
      clarificationSource: 'router',
      answer: null,
      question: intent.question,
    };
  }

  return { router, clarificationSource: null, answer: null, question: null };
};

export const preRoute = ({ answer, router, userRequest }: RootStateType) => {
  const userRequests = router.userRequests;

  if (answer) {
    userRequests.push(answer);
  } else {
    userRequests.push(userRequest);
  }

  return {
    router: { ...router, userRequests },
    clarificationSource: null,
    answer: null,
    question: null,
  };
};

export const afterRouterIntent = (state: RootStateType): string => {
  const intent = state.router.intent;
  if (!intent) return 'agent';
  if (intent.needsClarification) return 'question_node';

  if (intent.pipeline === 'direct_answer') return 'agent';
  if (intent.pipeline === 'direct_command') return 'agent';
  if (intent.shouldSearchCodebase) return 'file_selector';
  return 'planner';
};
