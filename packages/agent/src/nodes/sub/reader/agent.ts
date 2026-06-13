import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../../../utils';
import type { ReaderStateType } from '../../../subagents/reader/state';
import { READER_TOOLS } from '@robocode-packages/tools';

export const agentNode = async (state: ReaderStateType) => {
  const { sessionId, cwd } = state;

  EventBus.emit('llm:start', { sessionId });
  EventBus.emit('llm:thinking', { sessionId, text: 'Drafting response...' });

  const model = createBaseModel(true).bindTools(READER_TOOLS, {
    tool_choice: 'auto',
    ...(cwd ? { configurable: { cwd } } : {}),
  });

  const response = await model.invoke(state.messages);

  return {
    messages: [response],
    turnCount: state.turnCount + 1,
  };
};
