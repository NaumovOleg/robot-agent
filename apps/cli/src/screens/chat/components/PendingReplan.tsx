import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Plan } from '@robocode-packages/shared';

interface Props {
  plan: Plan & { reason?: string; attempt?: number };
  isActive: boolean;
  confirm: (approved: boolean) => void;
}

export const PendingReplan: React.FC<Props> = ({ plan, isActive, confirm }) => {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') { confirm(true); return; }
      if (input === 'n' || input === 'N' || key.escape) { confirm(false); return; }
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => (prev === 'yes' ? 'no' : 'yes'));
      }
      if (key.return || input === ' ') {
        confirm(selected === 'yes');
        setSelected('yes');
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={2} marginBottom={1}>
        <Text color="yellow" bold>⟳ Replanning</Text>
        {!!plan.attempt && (
          <Text color="gray" dimColor>attempt {plan.attempt}/3</Text>
        )}
      </Box>

      {plan.reason && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>reason: </Text>
          <Text color="white">{plan.reason}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray" dimColor>goal: </Text>
        <Text color="white">{plan.goal}</Text>
      </Box>

      {plan.steps && plan.steps.length > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
          {plan.steps.map((step, i) => (
            <Box key={step.id ?? i} gap={1}>
              <Text color="gray" dimColor>{i + 1}.</Text>
              <Text color="gray" dimColor>{step.kind}</Text>
              <Text color="white">{step.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box gap={3}>
        <Text color={selected === 'yes' ? 'green' : 'gray'} dimColor={selected !== 'yes'}>
          {selected === 'yes' ? '❯ ' : '  '}yes
        </Text>
        <Text color={selected === 'no' ? 'red' : 'gray'} dimColor={selected !== 'no'}>
          {selected === 'no' ? '❯ ' : '  '}no
        </Text>
        <Text color="gray" dimColor>y/n ←/→</Text>
      </Box>
    </Box>
  );
};
