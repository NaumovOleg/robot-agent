import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PROVIDERS_LIST } from '@robocode-packages/config';
import { useProfile, useRouter } from '@hooks';
import { FormInput } from '@elements';

type Step = 'list' | 'create_name' | 'create_provider' | 'create_model' | 'create_apikey';

export const ProfileScreen: React.FC = () => {
  const { list, add, set } = useProfile();
  const { navigate } = useRouter();

  const profiles = list();
  const hasProfiles = profiles.length > 0;
  const listItems = [...profiles.map((p) => p.name), '+ create profile'];

  const [step, setStep] = useState<Step>(hasProfiles ? 'list' : 'create_name');
  const [selectedIndex, setSelectedIndex] = useState(
    hasProfiles
      ? Math.max(
          profiles.findIndex((p) => p.active),
          0
        )
      : 0
  );

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [providerIndex, setProviderIndex] = useState(0);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  const goBack = () => {
    if (step === 'create_name') setStep(hasProfiles ? 'list' : 'create_name');
    if (step === 'create_provider') setStep('create_name');
    if (step === 'create_model') setStep('create_provider');
    if (step === 'create_apikey') setStep('create_model');
  };

  useInput((input, key) => {
    if (step !== 'list' && step !== 'create_provider') return;

    if (step === 'list') {
      if (key.escape) navigate('welcome');
      if (key.downArrow) setSelectedIndex((i) => Math.min(i + 1, listItems.length - 1));
      if (key.upArrow) setSelectedIndex((i) => Math.max(i - 1, 0));
      if (input === ' ' || key.return) {
        const selected = listItems[selectedIndex];
        if (selected === '+ create profile') {
          setStep('create_name');
        } else {
          set(selected);
        }
      }
    }

    if (step === 'create_provider') {
      if (key.downArrow) setProviderIndex((i) => Math.min(i + 1, PROVIDERS_LIST.length - 1));
      if (key.upArrow) setProviderIndex((i) => Math.max(i - 1, 0));
      if (key.escape) goBack();
      if (input === ' ' || key.return) {
        setProvider(PROVIDERS_LIST[providerIndex]!);
        setStep('create_model');
      }
    }
  });

  if (step === 'list') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Profiles
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {listItems.map((item, i) => {
            const isActive = profiles.find((p) => p.name === item)?.active;
            const isSelected = i === selectedIndex;
            const isCreate = item === '+ create profile';

            return (
              <Box key={item}>
                <Text color={isSelected ? 'blueBright' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                  {!isCreate && (isActive ? '● ' : '○ ')}
                </Text>
                <Text
                  color={isCreate ? 'gray' : isSelected ? 'blueBright' : 'white'}
                  dimColor={isCreate}
                >
                  {item}
                </Text>
                {isActive && <Text color="green"> active</Text>}
              </Box>
            );
          })}
        </Box>

        <Box>
          <Text dimColor>↑↓ navigate SPACE/ENTER select</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'create_provider') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            Select provider
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {PROVIDERS_LIST.map((p, i) => (
            <Box key={p}>
              <Text color={i === providerIndex ? 'blueBright' : 'white'}>
                {i === providerIndex ? '▶ ' : '  '}
                {p}
              </Text>
            </Box>
          ))}
        </Box>

        <Box>
          <Text dimColor>↑↓ navigate SPACE/ENTER select ESC = back</Text>
        </Box>
      </Box>
    );
  }

  const inputProps =
    {
      create_name: {
        label: 'Profile name',
        value: name,
        onChange: setName,
        onSubmit: () => setStep('create_provider'),
      },
      create_model: {
        label: `Model for ${provider}`,
        value: model,
        onChange: setModel,
        onSubmit: () => setStep('create_apikey'),
      },
      create_apikey: {
        label: 'API key',
        value: apiKey,
        onChange: setApiKey,
        onSubmit: () => {
          add({ name, provider, model, apiKey });
          setStep('list');
        },
      },
    }[step] ?? null;

  if (!inputProps) return null;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Create profile
        </Text>
      </Box>

      {/* BREADCRUMB */}
      <Box marginBottom={1} gap={2}>
        <Text color={name ? 'green' : 'gray'}>{name ? `✓ ${name}` : 'name'}</Text>
        <Text color="gray">›</Text>
        <Text color={provider ? 'green' : 'gray'}>{provider ? `✓ ${provider}` : 'provider'}</Text>
        <Text color="gray">›</Text>
        <Text color={model ? 'green' : 'gray'}>{model ? `✓ ${model}` : 'model'}</Text>
        <Text color="gray">›</Text>
        <Text color={apiKey ? 'green' : 'gray'}>{apiKey ? '✓ api key' : 'api key'}</Text>
      </Box>

      <FormInput
        label={inputProps.label}
        value={inputProps.value}
        placeholder={`enter ${inputProps.label.toLowerCase()}...`}
        onChange={inputProps.onChange}
        onSubmit={inputProps.onSubmit}
        mask={step === 'create_apikey' ? '*' : undefined}
        onEscape={goBack}
      />

      <Box marginTop={1}>
        <Text dimColor>ENTER = next step ESC = back</Text>
      </Box>
    </Box>
  );
};
