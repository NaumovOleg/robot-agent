import React from 'react';
import { Box, Text } from 'ink';
import { ApproveFooter } from '@elements';
import { Plan } from '@robocode-packages/shared';

type Props = { plan: Plan; isActive: boolean; confirm: (state: boolean) => void };

const RISK_COLOR: Record<string, string> = { low: 'green', medium: 'yellow', high: 'red' };

export const PendingPlan: React.FC<Props> = ({ plan, isActive, confirm }) => {
  const riskColor = plan.risk ? (RISK_COLOR[plan.risk] ?? 'yellow') : 'gray';

  return (
    <Box flexDirection="column" marginY={1} padding={1} borderStyle="single" borderColor="blue">
      <Text color="blue" bold>
        Plan
      </Text>

      <Box marginTop={1}><Text>{plan.goal}</Text></Box>

      {plan.risk && (
        <Box gap={1} marginTop={1}>
          <Text color="gray">risk:</Text>
          <Text color={riskColor} bold>
            {plan.risk}
          </Text>
        </Box>
      )}

      {plan.files_affected && plan.files_affected.length > 0 && (
        <Box gap={1}>
          <Text color="gray">files:</Text>
          <Text color="cyan">{plan.files_affected.join(', ')}</Text>
        </Box>
      )}

      {plan.steps && plan.steps.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={1}>
          {plan.steps.map((step, i) => (
            <Text key={i} color="gray">
              {i + 1}. {step}
            </Text>
          ))}
        </Box>
      )}

      <ApproveFooter isActive={isActive} confirm={confirm} />
    </Box>
  );
};
