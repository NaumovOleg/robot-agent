import type { RootStateType } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';

export const afterAsk = (state: RootStateType): string => {
  const source = state.clarificationSource;
  debug('[afterAskUserRouter] routing back to source:', source);

  if (source === 'router') return 'pre_route';

  return 'agent';
};
