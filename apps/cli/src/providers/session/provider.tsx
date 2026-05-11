import React, { useMemo, useState, useCallback } from 'react';
import { SessionService } from '@robocode-packages/core';
import type { Session } from '@robocode-packages/shared';
import { SessionContext } from './ctx';

interface Props {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<Props> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>(() => SessionService.list());
  const [active, setActive] = useState<Session | null>(() => SessionService.active ?? null);

  const refreshMeta = useCallback(() => {
    setSessions(SessionService.list());
    setActive(SessionService.active ?? null);
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
      if (active?.id === id) {
        const nextMeta = sessions.find((m) => m.id !== id);
        if (nextMeta) {
          const nextSession = SessionService.load(nextMeta.id);
          setActive(nextSession ?? null);
        } else {
          setActive(null);
        }
      }
    },
    [active, sessions, refreshMeta]
  );

  const value = useMemo(
    () => ({
      create,
      delete: deleteSession,
      set: setActiveSession,
      active,
      list: sessions,
    }),
    [active, create, deleteSession, setActive, active, sessions]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
