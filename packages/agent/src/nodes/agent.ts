import { SystemMessage, AIMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import type { AgentStateType } from '../state';
import { MAX_AGENT_ITERATIONS } from '@robocode-packages/config';
import { getModel } from '../utils';
import { buildSystemPrompt } from '../prompts';
import { compressHistoryJson } from '../context/compressor';

export const agentNode = async (state: AgentStateType) => {
  const { sessionId, iterationCount, cwd } = state;

  if (iterationCount >= MAX_AGENT_ITERATIONS) {
    EventBus.emit('llm:error', { sessionId, error: 'Max iterations reached' });
    return { messages: [new AIMessage('Max iterations reached. Stopping.')] };
  }

  EventBus.emit('llm:start', { sessionId });

  const systemPrompt = await buildSystemPrompt(cwd);
  const model = getModel(true, cwd);
  const compressedMessages = await compressHistoryJson(state, model);

  const response = await model.invoke([new SystemMessage(systemPrompt), ...compressedMessages], {
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
