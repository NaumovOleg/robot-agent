import React, { useMemo, useState, useCallback } from 'react';
import { SessionService, EventBus, MessageService } from '@robocode-packages/core';
import { Session } from '@robocode-packages/shared';
import { SessionContext } from './ctx';

interface Props {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<Props> = ({ children }) => {
  const [sessions, setSessions] = useState<Session[]>(() => SessionService.list());
  const [session, setSession] = useState<Session | null>(() => SessionService.active ?? null);
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);

  const refreshMeta = useCallback(() => {
    setSessions(SessionService.list());
    setSession(SessionService.active ?? null);
  }, []);

  const inspectedSession = useMemo(
    () => sessions.find((item) => item.id === inspectedSessionId) ?? null,
    [sessions, inspectedSessionId]
  );

  const create = useCallback((): Session => {
    const newSession = SessionService.create();
    refreshMeta();
    EventBus.emit('agent:set-session', newSession);
    return newSession;
  }, [refreshMeta]);

  const forkSession = useCallback(
    (id: string): Session => {
      const forked = SessionService.fork(id);
      refreshMeta();
      EventBus.emit('agent:set-session', forked);
      return forked;
    },
    [refreshMeta]
  );

  const setActiveSession = useCallback((id: string | null) => {
    const set = SessionService.set(id);
    refreshMeta();
    if (set !== undefined) {
      EventBus.emit('agent:set-session', set);
    }
  }, []);

  const inspectSession = useCallback((id: string | null) => {
    setInspectedSessionId(id);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      SessionService.delete(id);
      const next = SessionService.list().find((m) => m.id !== id) ?? null;

      if (session?.id === id) {
        EventBus.emit('agent:stop', { sessionId: id });

        if (next) {
          const nextSession = SessionService.set(next.id) ?? SessionService.load(next.id);
          setSession(nextSession ?? null);
          setInspectedSessionId(null);
          EventBus.emit('agent:set-session', nextSession ?? null);
        } else {
          setSession(null);
          setInspectedSessionId(null);
          EventBus.emit('agent:set-session', null);
        }
      }

      refreshMeta();
    },
    [session, refreshMeta]
  );

  const renameSession = useCallback(
    (id: string, name: string) => {
      SessionService.rename(id, name);
      refreshMeta();
      const renamed = SessionService.load(id) ?? SessionService.get(id);
      if (!renamed) {
        throw new Error(`Session ${id} not found after rename`);
      }
      return renamed;
    },
    [refreshMeta]
  );

  const clearSession = useCallback(
    (id: string) => {
      MessageService.clear(id);
      const cleared = SessionService.clear(id);
      EventBus.emit('agent:delete-checkpoint', id);
      refreshMeta();
      return cleared;
    },
    [refreshMeta]
  );

  const value = useMemo(
    () => ({
      create,
      fork: forkSession,
      delete: deleteSession,
      set: setActiveSession,
      rename: renameSession,
      clear: clearSession,
      inspect: inspectSession,
      session,
      inspectedSession,
      list: sessions,
    }),
    [
      session,
      inspectedSession,
      create,
      forkSession,
      deleteSession,
      setActiveSession,
      inspectSession,
      renameSession,
      clearSession,
      sessions,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
