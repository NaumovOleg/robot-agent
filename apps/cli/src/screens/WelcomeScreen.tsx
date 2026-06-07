import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { PALETTE } from '@utils';

const VERSION = '0.1.0';
const LOGO_TEXT = 'R O B O C O D E';

export const WelcomeScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { list, active } = useProfile();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useInput((input, key) => {
    if (activeProfile) return;
    if (input === 'y' || input === 'Y') navigate('profile');
    if (input === 'n' || input === 'N' || key.escape) navigate('assistant');
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="column">
        <Text color={PALETTE.teal} bold>{LOGO_TEXT}</Text>
        <Text color={PALETTE.muted}>AI CODE ASSISTANT · v{VERSION}</Text>
      </Box>

      {!activeProfile && (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text color={PALETTE.muted}>No profile configured.</Text>
          <Box gap={3}>
            <Text color={PALETTE.sage}>[ Y ] Set up profile</Text>
            <Text color={PALETTE.muted}>[ N ] Skip</Text>
          </Box>
          <Text color={PALETTE.faint} dimColor>y / n</Text>
        </Box>
      )}
    </Box>
  );
};
