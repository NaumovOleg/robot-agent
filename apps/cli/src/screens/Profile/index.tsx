import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { AI_PROVIDERS, PROVIDERS_LIST } from '@robocode-packages/config';
import { useProfile, useRouter } from '@hooks';
import { FormInput } from '@elements';
import { debug } from '@robocode-packages/shared';

type Step =
  | 'list'
  | 'dropdown'
  | 'confirm_delete'
  | 'create_name'
  | 'create_provider'
  | 'create_model'
  | 'create_apikey'
  | 'edit_provider'
  | 'edit_model'
  | 'edit_apikey';

const DROPDOWN_ITEMS = ['activate', 'edit', 'delete'] as const;
type DropdownAction = (typeof DROPDOWN_ITEMS)[number];

const STEPS_WITH_INPUT: Step[] = [
  'list',
  'dropdown',
  'confirm_delete',
  'create_provider',
  'edit_provider',
];

export const ProfileScreen: React.FC = () => {
  const { list, add, set, delete: del, update } = useProfile();
  const { navigate } = useRouter();

  const profiles = list();

  debug('profiles', profiles);
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
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [targetId, setTargetId] = useState('');

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [providerIndex, setProviderIndex] = useState(0);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  const targetProfile = profiles.find((p) => p.id === targetId);

  const goBack = () => {
    if (step === 'create_name') {
      setStep(hasProfiles ? 'list' : 'create_name');
      return;
    }
    if (step === 'create_provider') {
      setStep('create_name');
      return;
    }
    if (step === 'create_model') {
      setStep('create_provider');
      return;
    }
    if (step === 'create_apikey') {
      setStep('create_model');
      return;
    }
    if (step === 'edit_provider') {
      setStep('dropdown');
      return;
    }
    if (step === 'edit_model') {
      setStep('edit_provider');
      return;
    }
    if (step === 'edit_apikey') {
      setStep('edit_model');
      return;
    }
    if (step === 'dropdown') {
      setStep('list');
      return;
    }
    if (step === 'confirm_delete') {
      setStep('dropdown');
      return;
    }
  };

  const openDropdown = (id: string) => {
    setTargetId(id);
    setDropdownIndex(0);
    setStep('dropdown');
  };

  const handleDropdownSelect = (action: DropdownAction) => {
    if (action === 'activate') {
      set(targetId);
      setStep('list');
    }
    if (action === 'edit') {
      const p = profiles.find((pr) => pr.id === targetId);
      setProvider(p?.provider ?? '');
      setModel(p?.model ?? '');
      setApiKey('');
      setProviderIndex(Math.max(PROVIDERS_LIST.indexOf((p?.provider as AI_PROVIDERS) ?? ''), 0));
      setStep('edit_provider');
    }
    if (action === 'delete') {
      setStep('confirm_delete');
    }
  };

  useInput((input, key) => {
    if (!STEPS_WITH_INPUT.includes(step)) return;

    if (step === 'list') {
      if (key.escape) {
        navigate('welcome');
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, listItems.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return) {
        const selectedName = listItems[selectedIndex];
        if (selectedName === '+ create profile') {
          setName('');
          setProvider('');
          setModel('');
          setApiKey('');
          setProviderIndex(0);
          setStep('create_name');
        } else {
          const p = profiles.find((pr) => pr.name === selectedName);
          if (p) openDropdown(p.id);
        }
        return;
      }
      if (input === ' ') {
        const selectedName = listItems[selectedIndex];
        if (selectedName && selectedName !== '+ create profile') {
          const p = profiles.find((pr) => pr.name === selectedName);
          if (p) set(p.id);
        }
        return;
      }
    }

    if (step === 'dropdown') {
      if (key.escape) {
        goBack();
        return;
      }
      if (key.downArrow) {
        setDropdownIndex((i) => Math.min(i + 1, DROPDOWN_ITEMS.length - 1));
        return;
      }
      if (key.upArrow) {
        setDropdownIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return || input === ' ') {
        handleDropdownSelect(DROPDOWN_ITEMS[dropdownIndex]!);
        return;
      }
    }

    if (step === 'confirm_delete') {
      if (key.escape || input === 'n' || input === 'N') {
        setStep('dropdown');
        return;
      }
      if (input === 'y' || input === 'Y') {
        del(targetId);
        setSelectedIndex(0);
        setTargetId('');
        setStep('list');
        return;
      }
    }

    if (step === 'create_provider' || step === 'edit_provider') {
      if (key.escape) {
        goBack();
        return;
      }
      if (key.downArrow) {
        setProviderIndex((i) => Math.min(i + 1, PROVIDERS_LIST.length - 1));
        return;
      }
      if (key.upArrow) {
        setProviderIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (input === ' ' || key.return) {
        setProvider(PROVIDERS_LIST[providerIndex]!);
        setStep(step === 'create_provider' ? 'create_model' : 'edit_model');
        return;
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
            const profile = profiles.find((p) => p.name === item);
            const isActive = profile?.active;
            const isSelected = i === selectedIndex;
            const isCreate = item === '+ create profile';

            return (
              <Box key={isCreate ? item : profile!.id}>
                <Text color={isSelected ? 'blueBright' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                  {!isCreate && (isActive ? '● ' : '○ ')}
                </Text>
                <Text
                  color={isCreate ? 'gray' : isSelected ? 'blueBright' : 'white'}
                  dimColor={isCreate && !isSelected}
                >
                  {item}
                </Text>
                {isActive && <Text color="green"> active</Text>}
              </Box>
            );
          })}
        </Box>

        <Box>
          <Text dimColor>↑↓ navigate ENTER = options SPACE = activate ESC = back</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'dropdown') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            {targetProfile?.name}
          </Text>
          {targetProfile?.active && <Text color="green"> active</Text>}
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">
            {' '}
            {targetProfile?.provider} / {targetProfile?.model}
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {DROPDOWN_ITEMS.map((action, i) => {
            const isSelected = i === dropdownIndex;
            const color =
              action === 'delete'
                ? isSelected
                  ? 'red'
                  : 'gray'
                : isSelected
                  ? 'blueBright'
                  : 'white';

            return (
              <Box key={action}>
                <Text color={isSelected ? 'blueBright' : 'white'}>{isSelected ? '▶ ' : '  '}</Text>
                <Text color={color} dimColor={!isSelected}>
                  {action}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box>
          <Text dimColor>↑↓ navigate ENTER = select ESC = back</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'confirm_delete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="red" bold>
            Delete profile
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text>Delete </Text>
          <Text color="white" bold>
            {targetProfile?.name}
          </Text>
          <Text>? This cannot be undone.</Text>
        </Box>

        <Box gap={3}>
          <Text color="red" bold>
            Y yes, delete
          </Text>
          <Text color="gray">N cancel</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>press Y or N ESC = cancel</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'create_provider' || step === 'edit_provider') {
    const isEdit = step === 'edit_provider';

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            {isEdit ? `Edit ${targetProfile?.name}` : 'Create profile'}
          </Text>
          <Text color="gray"> select provider</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {PROVIDERS_LIST.map((p, i) => (
            <Box key={p}>
              <Text color={i === providerIndex ? 'blueBright' : 'white'}>
                {i === providerIndex ? '▶ ' : '  '}
                {p}
              </Text>
              {isEdit && p === targetProfile?.provider && (
                <Text color="gray" dimColor>
                  {' '}
                  current
                </Text>
              )}
            </Box>
          ))}
        </Box>

        <Box>
          <Text dimColor>↑↓ navigate ENTER = select ESC = back</Text>
        </Box>
      </Box>
    );
  }

  const isEdit = step === 'edit_model' || step === 'edit_apikey';

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
          setName('');
          setModel('');
          setApiKey('');
          setStep('list');
        },
      },
      edit_model: {
        label: `Model for ${provider}`,
        value: model,
        onChange: setModel,
        onSubmit: () => setStep('edit_apikey'),
      },
      edit_apikey: {
        label: 'New API key (leave empty to keep current)',
        value: apiKey,
        onChange: setApiKey,
        onSubmit: () => {
          update({ id: targetId, provider, model, ...(apiKey ? { apiKey } : {}) });
          setModel('');
          setApiKey('');
          setStep('list');
        },
      },
    }[step] ?? null;

  if (!inputProps) return null;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {isEdit ? `Edit ${targetProfile?.name}` : 'Create profile'}
        </Text>
      </Box>

      <Box marginBottom={1} gap={2}>
        <Text color={name || isEdit ? 'green' : 'gray'}>
          {name || isEdit ? `✓ ${isEdit ? targetProfile?.name : name}` : 'name'}
        </Text>
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
        mask={step === 'create_apikey' || step === 'edit_apikey' ? '*' : undefined}
        onEscape={goBack}
      />

      <Box marginTop={1}>
        <Text dimColor>ENTER = next ESC = back</Text>
      </Box>
    </Box>
  );
};
