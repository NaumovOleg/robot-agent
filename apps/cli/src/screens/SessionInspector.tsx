import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useSession } from '@hooks';
import { AuditService, TranscriptService } from '@robocode-packages/core';

const MAX_TRANSCRIPT_LINES = 80;
const MAX_AUDIT_ENTRIES = 12;

const truncate = (value: string, max = 120): string =>
  value.length > max ? `${value.slice(0, max - 3)}...` : value;

export const SessionInspector: React.FC = () => {
  const { session, inspectedSession, inspect, set: setSession, list: sessions } = useSession();
  const { back, navigate } = useRouter();
  const viewedSession = inspectedSession ?? session;
  const viewedIndex = viewedSession ? sessions.findIndex((item) => item.id === viewedSession.id) : -1;

  const selectRelativeSession = (direction: -1 | 1) => {
    if (sessions.length === 0 || viewedIndex < 0) return;
    const nextIndex = (viewedIndex + direction + sessions.length) % sessions.length;
    const nextSession = sessions[nextIndex];
    if (!nextSession) return;
    inspect(nextSession.id);
  };

  const transcript = useMemo(() => {
    if (!viewedSession) return [];
    return TranscriptService.read(viewedSession.id)
      .split('\n')
      .filter(Boolean)
      .slice(-MAX_TRANSCRIPT_LINES);
  }, [viewedSession?.id]);

  const auditEntries = useMemo(() => {
    if (!viewedSession) return [];
    return AuditService.tail(viewedSession.id, MAX_AUDIT_ENTRIES);
  }, [viewedSession?.id]);

  useInput((_, key) => {
    if (key.escape) {
      inspect(null);
      back();
      return;
    }
    if (key.leftArrow) {
      selectRelativeSession(-1);
      return;
    }
    if (key.rightArrow) {
      selectRelativeSession(1);
      return;
    }
    if (key.return) {
      if (viewedSession) {
        inspect(null);
        setSession(viewedSession.id);
      }
      navigate('assistant');
    }
  });

  if (!viewedSession) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow" bold>
          No active session
        </Text>
        <Text dimColor>Open or create a session to inspect its transcript.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {viewedSession.name}
        </Text>
        <Text color="gray"> / </Text>
        <Text color="white">session history</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray" dimColor>
          Transcript: {viewedSession.transcriptPath ?? TranscriptService.path(viewedSession.id)}
        </Text>
        <Text color="gray" dimColor>
          Audit: {viewedSession.auditPath ?? AuditService.path(viewedSession.id)}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="blueBright" bold>
          Transcript tail
        </Text>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          {transcript.length > 0 ? (
            transcript.map((line, index) => (
              <Text key={index} dimColor={line.trim().length === 0}>
                {truncate(line, 140)}
              </Text>
            ))
          ) : (
            <Text dimColor>No transcript yet.</Text>
          )}
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text color="blueBright" bold>
          Audit tail
        </Text>
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          {auditEntries.length > 0 ? (
            auditEntries.map((entry, index) => {
              const payload = JSON.stringify(entry.payload);
              return (
                <Text key={index} dimColor>
                  {entry.timestamp} {entry.event} {truncate(payload, 100)}
                </Text>
              );
            })
          ) : (
            <Text dimColor>No audit entries yet.</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>LEFT/RIGHT = switch session ENTER = assistant ESC = back</Text>
      </Box>
    </Box>
  );
};
