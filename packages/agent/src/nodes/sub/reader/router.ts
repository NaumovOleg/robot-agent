import type { AIMessage } from '@langchain/core/messages';
import type { ReaderStateType } from '@robocode-packages/shared';

export function router(state: ReaderStateType): string {
  const lastMessage = state.messages.at(-1);
  const hasToolCalls = (lastMessage as AIMessage)?.tool_calls?.length;
  if (state.turnCount >= state.maxTurns) {
    return 'final';
  }
  if (hasToolCalls) return 'tools';
  return 'final';
}
