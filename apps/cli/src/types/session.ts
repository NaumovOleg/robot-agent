import type { Session } from '@robocode-packages/shared';

export interface SessionState {
  create: () => Session;
  delete: (id: string) => void;
  set: (id: string) => void;
  session: Session | null;
  list: Session[];
}
