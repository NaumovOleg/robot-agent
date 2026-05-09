import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { CommandInput } from '../components';
import { ProviderScreen } from './provider';

const ROBOT_LOGO = [' █▀█ █▀█ █▄▄ █▀█ █▀▀ █▀█ █▀▄ █▀▀ ', ' █▀▄ █▄█ █▄█ █▄█ █▄▄ █▄█ █▄▀ ██▄ '];

const AI_MODELS = {
  openai: ['gpt-4', 'gpt-3.5-turbo'],
  anthropic: ['claude-v1', 'claude-instant'],
};

export const WelcomeScreen: React.FC = () => {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [step, setStep] = useState<'provider' | 'model' | 'apikey'>('provider');

  const isLoggedIn = apiKey.trim().length > 0;

  const onProviderSelect = (item: { label: string; value: string }) => {
    setProvider(item.value);
    setStep('model');
  };

  const onModelSubmit = (value: string) => {
    if (provider && AI_MODELS[provider].includes(value)) {
      setModel(value);
      setStep('apikey');
    }
  };

  const onApiKeySubmit = (value: string) => {
    if (value.trim().length > 0) {
      setApiKey(value.trim());
    }
  };

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* LOGO */}
      <Box flexDirection="column" marginBottom={1}>
        {ROBOT_LOGO.map((line, i) => (
          <Text key={i} color={i < 5 ? 'blueBright' : 'blue'}>
            {line}
          </Text>
        ))}
      </Box>

      {/* SUBTITLE */}
      <Box marginBottom={1}>
        <Text color="gray"> AI runtime powered by LangGraph</Text>
      </Box>

      {/* STATUS */}
      <Box marginBottom={1}>
        <Text color={isLoggedIn ? 'green' : 'yellow'}>
          {'  '}● {isLoggedIn ? 'connected' : 'not logged in'}
        </Text>
      </Box>

      {/* DIVIDER */}
      <Box marginBottom={1}>
        <Text color="gray">
          {'  '}
          {'─'.repeat(50)}
        </Text>
      </Box>

      {/* CONTENT */}
      {isLoggedIn ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{'  '}Welcome 👋</Text>
          <Text color="gray">
            {'  '}You are logged in with provider {provider} and model {model}.
          </Text>
          <Text color="gray">{'  '}Press ENTER to continue to start page.</Text>
          <CommandInput
            placeholder="Press ENTER to continue"
            onSubmit={() => {
              // Handle continue to start page here
            }}
          />
        </Box>
      ) : step === 'provider' ? (
        <ProviderScreen onSelect={onProviderSelect} />
      ) : step === 'model' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            {'  '}Select AI model for {provider}:
          </Text>
          <Text color="gray">
            {'  '}Options: {AI_MODELS[provider].join(', ')}
          </Text>
          <CommandInput placeholder="Model" onSubmit={onModelSubmit} />
        </Box>
      ) : step === 'apikey' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{'  '}Enter API key:</Text>
          <CommandInput placeholder="API Key" onSubmit={onApiKeySubmit} />
        </Box>
      ) : null}
    </Box>
  );
};
