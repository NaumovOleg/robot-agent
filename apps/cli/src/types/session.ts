import type { Session } from '@robocode-packages/shared';

export interface SessionState {
  create: () => Session;
  fork: (id: string) => Session;
  delete: (id: string) => void;
  set: (id: string | null) => void;
  inspect: (id: string | null) => void;
  rename: (id: string, name: string) => Session;
  clear: (id: string) => Session;
  session: Session | null;
  inspectedSession: Session | null;
  list: Session[];
}
