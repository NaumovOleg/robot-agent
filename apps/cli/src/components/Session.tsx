// SessionList.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useSession, useRouter } from '@hooks';
import { ConfirmDelete } from '@elements';

const NEW_SESSION = '+ new session';
const DROPDOWN_ITEMS = ['open', 'delete'] as const;
type DropdownAction = (typeof DROPDOWN_ITEMS)[number];

type Step = 'list' | 'dropdown' | 'confirm_delete';

export const SessionList: React.FC = () => {
  const { list: sessions, create, set: setSession, delete: del } = useSession();
  const { navigate } = useRouter();

  const items = [...sessions, { id: NEW_SESSION, name: NEW_SESSION }];

  const [step, setStep] = useState<Step>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownIndex, setDropdownIndex] = useState(0);
  const [targetId, setTargetId] = useState('');

  const targetSession = sessions.find((s) => s.id === targetId);

  const openDropdown = (id: string) => {
    setTargetId(id);
    setDropdownIndex(0);
    setStep('dropdown');
  };

  const handleSelect = (action: DropdownAction) => {
    if (action === 'open') {
      setSession(targetId);
      navigate('assistant');
    }
    if (action === 'delete') {
      setStep('confirm_delete');
    }
  };

  useInput((input, key) => {
    if (step === 'list') {
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return || input === ' ') {
        const item = items[selectedIndex];
        if (item.id === NEW_SESSION) {
          create();
          navigate('assistant');
        } else {
          openDropdown(item.id);
        }
        return;
      }
    }

    if (step === 'dropdown') {
      if (key.escape) {
        setStep('list');
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
        handleSelect(DROPDOWN_ITEMS[dropdownIndex]);
        return;
      }
    }
  });

  if (step === 'dropdown') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1} paddingLeft={2}>
          <Text color="cyan" bold>
            {targetSession?.name}
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
              <Box key={action} paddingLeft={2}>
                <Text color={isSelected ? 'blueBright' : 'white'}>{isSelected ? '▶ ' : '  '}</Text>
                <Text color={color} dimColor={!isSelected}>
                  {action}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box paddingLeft={2}>
          <Text dimColor>↑↓ navigate ENTER = select ESC = back</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'confirm_delete') {
    return (
      <ConfirmDelete
        display={step === 'confirm_delete'}
        title="Delete session"
        cancel={() => {
          setStep('dropdown');
        }}
        confirm={() => {
          del(targetId);
          setTargetId('');
          setSelectedIndex(0);
          setStep('list');
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {items.map((item, i) => {
          const isSelected = i === selectedIndex;
          const isNew = item.id === NEW_SESSION;

          return (
            <Box key={item.id} paddingLeft={2}>
              <Text color={isSelected ? 'blueBright' : 'white'}>{isSelected ? '▶ ' : '  '}</Text>
              <Text
                color={isNew ? 'green' : isSelected ? 'blueBright' : 'white'}
                bold={isNew}
                dimColor={!isSelected && !isNew}
              >
                {item.name}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>↑↓ navigate ENTER = open TAB = switch page</Text>
      </Box>
    </Box>
  );
};
