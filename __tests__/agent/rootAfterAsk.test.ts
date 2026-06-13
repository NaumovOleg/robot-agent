import { afterAsk } from '../../packages/agent/src/nodes/root/afterAsk';

describe('afterAsk root routing', () => {
  it('routes router clarification answers back to pre_route', () => {
    expect(afterAsk({ clarificationSource: 'router' } as never)).toBe('pre_route');
  });

  it('routes planner clarification answers back to planner', () => {
    expect(afterAsk({ clarificationSource: 'planner' } as never)).toBe('planner');
  });

  it('falls back to agent when source is absent', () => {
    expect(afterAsk({ clarificationSource: null } as never)).toBe('agent');
  });
});
