import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

export interface GrepResults {
  file: string;
  matches: string[];
}
export interface ScoredFiles {
  file: string;
  score: number;
}

export const FileSelectorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  goal: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  keywords: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  selectedFiles: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  grepResults: Annotation<GrepResults[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  scoredFiles: Annotation<ScoredFiles[]>({
    reducer: (_, n) => n,
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
});
