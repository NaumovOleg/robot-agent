import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import type { RootStateType } from '@robocode-packages/shared';
import { debug, resolveQuestion } from '@robocode-packages/shared';

export const askUserNode = (state: RootStateType) => {
  const { sessionId, clarificationSource } = state;

  const question = resolveQuestion(state);

  debug('[askUserNode] source:', clarificationSource, '| question:', question);

  EventBus.emit('agent:question', { sessionId, question, source: clarificationSource });
  const answer: string = interrupt(question);

  // interrupt() has returned the answer — the question is resolved. Tell the UI
  // to clear pendingQuestion (this node re-emitted agent:question above when
  // LangGraph re-ran it on resume, which would otherwise leave a stale prompt).
  EventBus.emit('agent:question_answered', { sessionId, source: clarificationSource });
  debug('[askUserNode] resumed with answer:', answer);
  return { answer };
};
