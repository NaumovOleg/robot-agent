import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Command, END } from '@langchain/langgraph';
import { agent } from './graph';
import { MessageService, SessionService } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import { extractNewMessages } from './utils';

const { EventBus } = await import('@robocode-packages/core');

export const runAgent = async (sessionId: string, userInput: string) => {
  const session = SessionService.load(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const config = {
    configurable: { thread_id: sessionId, cwd: session.cwd },
    recursionLimit: 200,
  };

  const userMessage = new HumanMessage(userInput);
  MessageService.add(sessionId, userMessage);

  const history = MessageService.load(sessionId);
  debug('HISTORY', history, 'messages');

  const result = await agent.invoke(
    { messages: [userMessage], sessionId, cwd: session.cwd },
    config
  );

  const resultMessages: BaseMessage[] = result.messages ?? [];
  const newMessages = extractNewMessages(history, resultMessages);

  debug('NEW MESSAGES from agent:', newMessages.length);

  if (newMessages.length > 0) {
    _saveNewMessages(sessionId, newMessages);
  }

  return result;
};

export const resumeAgent = async (
  sessionId: string,
  decision: 'approve' | 'reject' | 'y' | 'n'
) => {
  const session = SessionService.load(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const config = {
    configurable: { thread_id: sessionId, cwd: session.cwd },
    recursionLimit: 200,
  };

  const historyBefore = MessageService.load(sessionId);
  debug('BEFORE RESUME:', historyBefore);
  const result = await agent.invoke(new Command({ resume: decision }), config);

  const resultMessages: BaseMessage[] = result.messages ?? [];
  const newMessages = extractNewMessages(historyBefore, resultMessages);

  debug('NEW MESSAGES after resume:', newMessages);

  if (newMessages.length > 0) {
    _saveNewMessages(sessionId, newMessages);
  }

  return result;
};

const _saveNewMessages = (sessionId: string, messages: BaseMessage[]) => {
  MessageService.addMany(sessionId, messages);

  const total = MessageService.count(sessionId);
  SessionService.updateMessageCount(sessionId, total);
};

export const stopAgent = async (sessionId: string) => {
  const config = { configurable: { thread_id: sessionId } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await agent.invoke(new Command({ goto: END as any }), config);
  EventBus.emit('agent:stopped', { sessionId });
};

export { agent, buildGraph } from './graph';
export type * from './state';
