import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useProfile, useRouter, useSession } from '@hooks';
import { ROOT_DIR, SESSION_INDEX_PATH, SESSIONS_DIR_PATH, DB_PATH } from '@robocode-packages/config';
import { TranscriptService, AuditService } from '@robocode-packages/core';

export const SettingsScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { session } = useSession();
  const { profile } = useProfile();

  useInput((_, key) => {
    if (key.escape) {
      navigate('welcome');
      return;
    }
    if (key.return && session) {
      navigate('assistant');
    }
    if (key.tab) {
      navigate('history');
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Settings
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="white">Active profile: {profile?.name ?? 'none'}</Text>
        <Text color="white">Active session: {session?.name ?? 'none'}</Text>
        <Text color="gray" dimColor>
          Session transcript: {session?.transcriptPath ?? (session ? TranscriptService.path(session.id) : 'n/a')}
        </Text>
        <Text color="gray" dimColor>
          Session audit log: {session?.auditPath ?? (session ? AuditService.path(session.id) : 'n/a')}
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="blueBright" bold>
          Storage
        </Text>
        <Text color="gray" dimColor>
          Root: {ROOT_DIR}
        </Text>
        <Text color="gray" dimColor>
          Sessions: {SESSIONS_DIR_PATH}
        </Text>
        <Text color="gray" dimColor>
          Session index: {SESSION_INDEX_PATH}
        </Text>
        <Text color="gray" dimColor>
          Checkpoints: {DB_PATH}
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text color="blueBright" bold>
          Keys
        </Text>
        <Text dimColor>ESC = welcome</Text>
        <Text dimColor>ENTER = assistant</Text>
        <Text dimColor>TAB = history</Text>
      </Box>
    </Box>
  );
};
