import type { RootStateType } from '@robocode-packages/shared';

export const preRoute = ({ answer, router, userRequest }: RootStateType) => {
  const userRequests = [...(router.userRequests ?? [])];

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
