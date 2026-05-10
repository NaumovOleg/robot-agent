import type { BaseMessage } from '@langchain/core/messages';

export interface SessionMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}

export interface Session {
  meta: SessionMeta;
  messages: BaseMessage[];
}
