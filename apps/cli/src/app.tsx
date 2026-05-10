import { Box, Text, useInput } from 'ink';
import { WelcomeScreen, ProfileScreen } from './screens';
import { RouterProvider, ProfileProvider } from '@providers';
import { useRouter, useProfile } from '@hooks';
import { Navigation } from '@components';

const Screen = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  if (route === 'chat' && !activeProfile) {
    navigate('welcome');
    return null;
  }

  switch (route) {
    case 'welcome':
      return <WelcomeScreen key="welcome" />;
    case 'profile':
      return <ProfileScreen key="profile" />;
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
      <App />
    </ProfileProvider>
  </RouterProvider>
);
