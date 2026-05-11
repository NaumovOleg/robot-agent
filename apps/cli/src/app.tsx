import { Box, Text } from 'ink';
import { WelcomeScreen, ProfileScreen, ChatScreen } from '@screens';
import { RouterProvider, ProfileProvider, SessionProvider } from '@providers';
import { useRouter, useProfile, useSession } from '@hooks';
import { Navigation } from '@components';
import { useEffect } from 'react';

const Screen = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();
  const { session } = useSession();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useEffect(() => {
    if (session && activeProfile) {
      navigate('assistant');
    }
  }, [session]);

  if (route === 'assistant' && !activeProfile) {
    navigate('welcome');
    return null;
  }

  switch (route) {
    case 'welcome':
      return <WelcomeScreen key="welcome" />;
    case 'profile':
      return <ProfileScreen key="profile" />;
    case 'assistant':
      return <ChatScreen key="chat" />;
    default:
      return <Text>Loading...</Text>;
  }
};

const App = () => {
  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        <Screen />
      </Box>
      <Navigation />
    </Box>
  );
};

export const APP = (
  <RouterProvider>
    <ProfileProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ProfileProvider>
  </RouterProvider>
);
