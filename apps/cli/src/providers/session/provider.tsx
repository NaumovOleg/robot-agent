import React, { useMemo, useState, useCallback } from 'react';
import { SessionService } from '@robocode-packages/core';
import type { Session, SessionMeta } from '@robocode-packages/shared';
import { toBaseMessage } from '@robocode-packages/shared';
import { SessionContext } from './ctx';

interface Props {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<Props> = ({ children }) => {
  const [sessions, setSessions] = useState<SessionMeta[]>(() => SessionService.list());
  const [active, setActiveSession] = useState<SessionMeta | null>(
    () => SessionService.active?.meta ?? null
  );
  const [messages, setMessages] = useState<Session['messages']>(
    () => SessionService.active?.messages ?? []
  );

  const refreshMeta = useCallback(() => {
    setSessions(SessionService.list());
    setActiveSession(SessionService.active?.meta ?? null);
  }, []);

  const create = useCallback((): Session => {
    const newSession = SessionService.create();
    refreshMeta();
    return newSession;
  }, [refreshMeta]);

  const setActive = useCallback((id: string | null) => {
    SessionService.set(id);
    refreshMeta();
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      SessionService.delete(id);
      refreshMeta();
      if (active?.id === id) {
        const nextMeta = sessions.find((m) => m.id !== id);
        if (nextMeta) {
          const nextSession = SessionService.load(nextMeta.id);
          setActive(nextSession?.meta?.id ?? null);
        } else {
          setActive(null);
          localStorage.removeItem('activeSessionId');
        }
      }
    },
    [active, sessions, refreshMeta]
  );

  const addMessage = useCallback(
    (msg: unknown) => {
      if (!active) throw new Error('No active session');
      const baseMsg = toBaseMessage(msg);
      SessionService.addMessage(active.id, baseMsg);
      refreshMeta();
      setMessages((all) => all.concat(baseMsg));
    },
    [active, refreshMeta]
  );

  const value = useMemo(
    () => ({
      messages,
      create,
      delete: deleteSession,
      set: setActive,
      active,
      list: sessions,
      addMessage,
    }),
    [active, create, deleteSession, setActive, active, sessions, addMessage]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
