import { Checkpointer } from '@robocode-packages/core';

export const getSessionState = async (sessionId: string) => {
  const checkpointer = Checkpointer.getInstance();
  try {
    const config = { configurable: { thread_id: `${sessionId}_main` } };
    const state = await checkpointer.get(config);
    return state;
  } catch {
    return null;
  }
};

export const canResume = async (sessionId: string): Promise<boolean> => {
  const state = await getSessionState(sessionId);
  if (!state) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tasks = (state as any).tasks ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tasks.some((t: any) => t.interrupts?.length > 0);
};
