import type { SessionMeta, Session } from '@robocode-packages/shared';

export interface SessionState {
  messages: Session['messages'];
  create: () => Session;
  delete: (id: string) => void;
  set: (id: string) => void;
  active: SessionMeta | null;
  list: SessionMeta[];
  addMessage: (msg: unknown) => void;
}
