import { HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { agent } from './graph';
import { MessageService } from '@robocode-packages/core';

export const runAgent = async (sessionId: string, userInput: string) => {
  const config = { configurable: { thread_id: sessionId } };
  const userMessage = new HumanMessage(userInput);

  MessageService.add(sessionId, userMessage);

  const history = MessageService.load(sessionId);

  const result = await agent.invoke({ messages: history, sessionId }, config);
  console.log(result);
  return result;
};

export const resumeAgent = async (
  sessionId: string,
  decision: 'approve' | 'reject' | 'y' | 'n'
) => {
  const config = { configurable: { thread_id: sessionId } };
  return agent.invoke(new Command({ resume: decision }), config);
};

export { agent, buildGraph } from './graph';
export type * from './state';
