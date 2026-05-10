import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';

const ROBOT_LOGO = [
  '  ╦═╗╔═╗╔╗ ╔═╗╔═╗╔═╗╔╦╗╔═╗',
  '  ╠╦╝║ ║╠╩╗║ ║║  ║ ║ ║║║╣ ',
  '  ╩╚═╚═╝╚═╝╚═╝╚═╝╚═╝═╩╝╚═╝',
];

interface Session {
  id: string;
  name: string;
}

const MOCK_SESSIONS: Session[] = [
  { id: '1', name: 'Fix auth bug in Express' },
  { id: '2', name: 'Refactor database layer' },
  { id: '3', name: 'Write unit tests for API' },
];

const NEW_SESSION = '+ new session';

export const WelcomeScreen: React.FC = () => {
  const { list, active } = useProfile();
  const { navigate } = useRouter();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  const sessionItems = [...MOCK_SESSIONS.map((s) => s.name), NEW_SESSION];
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (!activeProfile) {
      if (input === 'y' || input === 'Y') navigate('profile');
      if (input === 'n' || input === 'N' || key.escape) navigate('chat');
      return;
    }

    if (key.downArrow) setSelectedIndex((i) => Math.min(i + 1, sessionItems.length - 1));
    if (key.upArrow) setSelectedIndex((i) => Math.max(i - 1, 0));

    if (input === ' ' || key.return) {
      navigate('chat');
    }

    if (input === 'p' || input === 'P') navigate('profile');
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* LOGO */}
      <Box flexDirection="column" marginBottom={1}>
        {ROBOT_LOGO.map((line, i) => (
          <Text key={i} color={i === 0 ? 'blueBright' : i === 1 ? 'blue' : 'blueBright'}>
            {line}
          </Text>
        ))}
      </Box>

      {/* SUBTITLE */}
      <Box marginBottom={1}>
        <Text color="gray"> AI code assistant</Text>
      </Box>

      {/* STATUS */}
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

      {/* DIVIDER */}
      <Box marginBottom={1}>
        <Text color="gray">
          {'  '}
          {'─'.repeat(50)}
        </Text>
      </Box>

      {/* NO PROFILE */}
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
        /* HAS PROFILE — SESSION LIST */
        <Box flexDirection="column" gap={1}>
          <Box paddingLeft={2} marginBottom={1}>
            <Text color="white">Welcome back 👋 </Text>
            <Text color="gray">choose a session or start new</Text>
          </Box>

          <Box flexDirection="column">
            {sessionItems.map((item, i) => {
              const isSelected = i === selectedIndex;
              const isNew = item === NEW_SESSION;

              return (
                <Box key={item} paddingLeft={2}>
                  <Text color={isSelected ? 'blueBright' : 'white'}>
                    {isSelected ? '▶ ' : '  '}
                  </Text>
                  <Text
                    color={isNew ? 'green' : isSelected ? 'blueBright' : 'white'}
                    bold={isNew}
                    dimColor={!isSelected && !isNew}
                  >
                    {item}
                  </Text>
                </Box>
              );
            })}
          </Box>

          <Box paddingLeft={2} marginTop={1}>
            <Text dimColor>↑↓ navigate ENTER/SPACE = open P = profiles Ctrl+C = exit</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
