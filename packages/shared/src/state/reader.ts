import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { ReaderOutput } from '../types';

export const ReaderState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  cwd: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  task: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  focus: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  current_plan_step: Annotation<string | undefined>({
    reducer: (_, n) => n,
    default: () => undefined,
  }),
  user_goal: Annotation<string | undefined>({
    reducer: (_, n) => n,
    default: () => undefined,
  }),
  instructions: Annotation<string | undefined>({
    reducer: (_, n) => n,
    default: () => undefined,
  }),
  maxTurns: Annotation<number>({
    reducer: (_, n) => n,
    default: () => 40,
  }),
  turnCount: Annotation<number>({
    reducer: (_, n) => n,
    default: () => 0,
  }),
  editIntentInputPayload: Annotation<ReaderOutput | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});
