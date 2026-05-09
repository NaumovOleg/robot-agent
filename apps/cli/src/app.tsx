import { useState } from 'react';
import { render, Text } from 'ink';
import { WelcomeScreen, LoginScreen, ProviderScreen } from './screens';
import { CONFIG_PATH } from '@robocode-packages/config';
import { RouterProvider } from '@providers';

console.log(CONFIG_PATH);

type Step = 'welcome' | 'login' | 'provider' | 'done';

const App = () => {
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');

  const isLoggedIn = Boolean(apiKey);

  switch (step) {
    case 'welcome':
      return (
        <WelcomeScreen
          isLoggedIn={isLoggedIn}
          onLogin={(key) => {
            setApiKey(key);
            setStep('provider');
          }}
          onContinue={() => setStep('login')}
        />
      );

    case 'login':
      return (
        <LoginScreen
          onSubmit={(key) => {
            setApiKey(key);
            setStep('provider');
          }}
        />
      );

    case 'provider':
      return (
        <ProviderScreen
          onSelect={(item) => {
            saveConfig({ apiKey, provider: item.value });
            setStep('done');
          }}
        />
      );

    case 'done':
      return <Text>✅ Setup complete. Run: robot-agent chat</Text>;

    default:
      return <Text>Loading...</Text>;
  }
};

export const APP = render(
  <RouterProvider>
    <App />
  </RouterProvider>,
  {
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: true,
  }
);
