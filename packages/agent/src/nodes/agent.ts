import { SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import type { AgentStateType } from '../state';
import { MAX_AGENT_ITERATIONS } from '@robocode-packages/config';
import { getModel } from '../utils';
import { SYSTEM_PROMPT } from '../prompts';

export const agentNode = async (state: AgentStateType) => {
  const { sessionId, iterationCount } = state;

  if (iterationCount >= MAX_AGENT_ITERATIONS) {
    EventBus.emit('llm:error', { sessionId, error: 'Max iterations reached' });
    return {};
  }

  EventBus.emit('llm:start', { sessionId });

  const model = getModel(true);
  const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages], {
    callbacks: [
      {
        handleLLMNewToken(token: string) {
          EventBus.emit('llm:token', { sessionId, token });
        },
        handleLLMEnd() {
          EventBus.emit('llm:end', { sessionId });
        },
        handleLLMError(err: Error) {
          EventBus.emit('llm:error', { sessionId, error: err.message });
        },
      },
    ],
  });

  return { messages: [response], iterationCount: iterationCount + 1 };
};
