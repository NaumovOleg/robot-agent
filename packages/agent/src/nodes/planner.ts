import { getModel } from '../utils';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import { buildPlannerPrompt } from '../prompts';
import type { AgentStateType } from '../state';
export const plannerNode = async (state: AgentStateType) => {
  const { sessionId, cwd } = state;
  const lastMessage = state.messages.at(-1);
  if (!lastMessage) return {};

  EventBus.emit('llm:thinking', { sessionId, text: 'Planning...' });

  const plannerPrompt = await buildPlannerPrompt(cwd);
  const model = getModel(false);

  try {
    const response = await model.invoke(
      [new SystemMessage(plannerPrompt), new HumanMessage(`Task: ${lastMessage.content}`)],
      { tool_choice: 'none' }
    );

    const text = typeof response.content === 'string' ? response.content : '';
    let json = null;

    try {
      json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
    } catch (err) {
      console.error('Failed to parse planner JSON:', err, 'Response:', text);
    }

    // Validate parsed plan structure
    if (!json?.goal || !Array.isArray(json.steps)) {
      // Return a fallback plan with a note about invalid format
      const fallbackPlan = {
        goal: `Fallback plan - could not parse valid JSON plan from LLM: ${text.substring(0, 200)}`,
        steps: [],
        risk: 'medium',
        files_affected: [],
        approved: false,
      };
      EventBus.emit('agent:plan', { sessionId, plan: fallbackPlan });
      return { plan: fallbackPlan, approved: false };
    }

    const plan = { ...json, approved: false };

    EventBus.emit('agent:plan', { sessionId, plan });
    debug('RETURN PLAN ', plan);
    return { plan, approved: false };
  } catch {
    debug('FALLBACK  PLAN ', String(lastMessage.content));
    // Return a minimal default plan with 1 step asking for clarification
    return {
      plan: {
        goal: `Fallback plan - requesting clarification for task: ${String(lastMessage.content)}`,
        steps: [
          {
            action: 'ask_clarification',
            description: 'Please provide more details or clarify the task.',
          },
        ],
        risk: 'low',
        files_affected: [],
        approved: false,
      },
    };
  }
};
