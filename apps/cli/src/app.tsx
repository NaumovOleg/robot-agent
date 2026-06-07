import { Box, Text, useInput } from 'ink';
import {
  WelcomeScreen,
  ProfileScreen,
  ChatScreen,
  SessionInspector,
  SettingsScreen,
} from '@screens';
import { RouterProvider, ProfileProvider, SessionProvider } from '@providers';
import { useRouter, useProfile, useSession } from '@hooks';
import { useEffect, useRef } from 'react';

const Screen = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();
  const { session, create } = useSession();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  const sessionCreatingRef = useRef(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c' && route !== 'assistant') {
      process.exit(0);
    }
  });

  useEffect(() => {
    if (!activeProfile) return;
    if (!session) {
      if (!sessionCreatingRef.current) {
        sessionCreatingRef.current = true;
        create();
      }
      return;
    }
    sessionCreatingRef.current = false;
    if (route === 'welcome' || route === 'profile') {
      navigate('assistant');
    }
  }, [activeProfile?.id, session?.id, route]); // navigate and create are stable useCallback refs

  if (!activeProfile) {
    if (route !== 'welcome') navigate('welcome');
    return <WelcomeScreen key="welcome" />;
  }

  switch (route) {
    case 'assistant':
      return <ChatScreen key={session?.id ?? 'chat'} />;
    case 'history':
      return <SessionInspector key="history" />;
    case 'profile':
      return <ProfileScreen key="profile" />;
    case 'settings':
      return <SettingsScreen key="settings" />;
    default:
      return <Text>Loading...</Text>;
  }
};

const App = () => (
  <Box flexDirection="column" height="100%">
    <Screen />
  </Box>
);

export const APP = (
  <RouterProvider>
    <ProfileProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ProfileProvider>
  </RouterProvider>
);
