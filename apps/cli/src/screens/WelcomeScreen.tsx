import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { SessionList } from '@components';

const ROBOT_LOGO = [
  '  ╦═╗╔═╗╔╗ ╔═╗╔═╗╔═╗╔╦╗╔═╗',
  '  ╠╦╝║ ║╠╩╗║ ║║  ║ ║ ║║║╣ ',
  '  ╩╚═╚═╝╚═╝╚═╝╚═╝╚═╝═╩╝╚═╝',
];

export const WelcomeScreen: React.FC = () => {
  const { list, active } = useProfile();
  const { navigate } = useRouter();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useInput((input, key) => {
    if (!activeProfile) {
      if (input === 'y' || input === 'Y') {
        navigate('profile');
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        navigate('assistant');
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        {ROBOT_LOGO.map((line, i) => (
          <Text key={i} color={i === 0 ? 'blueBright' : i === 1 ? 'blue' : 'blueBright'}>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray"> AI code assistant</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={activeProfile ? 'green' : 'yellow'}>
          {'  '}● {activeProfile ? `connected as ${activeProfile.name}` : 'no active profile'}
        </Text>
        {activeProfile && (
          <Text color="gray">
            {'     '}
            {activeProfile.provider} / {activeProfile.model}
          </Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          {'  '}
          {'─'.repeat(50)}
        </Text>
      </Box>

      {!activeProfile ? (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>{'  '}Welcome 👋</Text>
            <Text color="gray">{'  '}No active profile found.</Text>
            <Text color="gray">{'  '}Would you like to set one up?</Text>
          </Box>

          <Box gap={3} paddingLeft={2}>
            <Text color="green" bold>
              Y yes, set up profile
            </Text>
            <Text color="gray">N skip for now</Text>
          </Box>

          <Box marginTop={1} paddingLeft={2}>
            <Text dimColor>press Y or N</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Box paddingLeft={2} marginBottom={1}>
            <Text color="white">Welcome back 👋 </Text>
            <Text color="gray">choose a session or start new</Text>
          </Box>

          <SessionList />
        </Box>
      )}
    </Box>
  );
};
