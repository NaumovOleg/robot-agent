const { preRoute } = await import('../../packages/agent/src/nodes/root/preRoute');

describe('root turn isolation', () => {
  test('preRoute appends current userRequest without mutating prior router state', () => {
    const priorRequests = ['Rename App to Page'];
    const state = {
      answer: null,
      userRequest: 'Add FAQ screen',
      router: { userRequests: priorRequests },
    } as any;

    const result = preRoute(state);

    expect(result.router.userRequests).toEqual(['Rename App to Page', 'Add FAQ screen']);
    expect(priorRequests).toEqual(['Rename App to Page']);
  });

  test('preRoute appends clarification answer immutably', () => {
    const priorRequests = ['Add FAQ screen'];
    const state = {
      answer: 'Use 5 default questions',
      userRequest: 'ignored on answer',
      router: { userRequests: priorRequests },
    } as any;

    const result = preRoute(state);

    expect(result.router.userRequests).toEqual(['Add FAQ screen', 'Use 5 default questions']);
    expect(priorRequests).toEqual(['Add FAQ screen']);
  });
});
