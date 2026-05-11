import React, { useMemo, useState, useCallback } from 'react';
import { SessionService } from '@robocode-packages/core';
import type { Session } from '@robocode-packages/shared';
import { SessionContext } from './ctx';

interface Props {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<Props> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>(() => SessionService.list());
  const [session, setSession] = useState<Session | null>(() => SessionService.active ?? null);

  const refreshMeta = useCallback(() => {
    setSessions(SessionService.list());
    setSession(SessionService.active ?? null);
  }, []);

  const create = useCallback((): Session => {
    const newSession = SessionService.create();
    refreshMeta();
    return newSession;
  }, [refreshMeta]);

  const setActiveSession = useCallback((id: string | null) => {
    SessionService.set(id);
    setSessions((list) => list.map((s) => ({ ...s, active: s.id === id })));
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      SessionService.delete(id);
      refreshMeta();
      if (session?.id === id) {
        const nextMeta = sessions.find((m) => m.id !== id);
        if (nextMeta) {
          const nextSession = SessionService.load(nextMeta.id);
          setSession(nextSession ?? null);
        } else {
          setSession(null);
        }
      }
    },
    [session, sessions, refreshMeta]
  );

  const value = useMemo(
    () => ({
      create,
      delete: deleteSession,
      set: setActiveSession,
      session,
      list: sessions,
    }),
    [session, create, deleteSession, setSession, sessions]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
