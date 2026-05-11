import { getModel } from '../utils';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { PLANNER_PROMPT } from '../prompts';
import type { AgentStateType } from '../state';

export const plannerNode = async (state: AgentStateType) => {
  const { sessionId } = state;
  const lastMessage = state.messages.at(-1);
  if (!lastMessage) return {};

  const model = getModel(false);

  EventBus.emit('llm:thinking', { sessionId, text: 'Planning...' });

  const response = await model.invoke([
    new SystemMessage(PLANNER_PROMPT),
    new HumanMessage(`Task: ${lastMessage.content}`),
  ]);

  try {
    const text = typeof response.content === 'string' ? response.content : '';
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, ''));
    const plan = { ...json, approved: false };

    EventBus.emit('agent:plan', { sessionId, plan });

    const approval = interrupt({ type: 'plan_approval', plan });

    if (approval === 'reject') {
      return { plan: null };
    }

    return { plan: { ...plan, approved: true } };
  } catch {
    return { plan: { goal: String(lastMessage.content), steps: [], approved: true } };
  }
};
