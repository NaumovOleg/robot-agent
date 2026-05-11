import { Box, Text, useInput } from 'ink';
import { FC, useState } from 'react';

type Props = { isActive: boolean; confirm: (approved: boolean) => void };

export const ApproveFooter: FC<Props> = ({ isActive, confirm }) => {
  const [selected, setSelected] = useState<'approve' | 'reject'>('approve');

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') {
        confirm(true);
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        confirm(false);
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => (prev === 'approve' ? 'reject' : 'approve'));
      } else if (key.return || input === ' ') {
        confirm(selected === 'approve');
        setSelected('approve');
      }
    },
    { isActive }
  );

  return (
    <>
      <Box marginTop={1} gap={2}>
        <Text color={selected === 'approve' ? 'greenBright' : 'green'}>
          {selected === 'approve' ? '▶ ' : '  '}✓ Yes
        </Text>
        <Text color={selected === 'reject' ? 'redBright' : 'red'}>
          {selected === 'reject' ? '▶ ' : '  '}✗ No
        </Text>
      </Box>
      <Text dimColor>y/n  ←/→ navigate  Enter confirm</Text>
    </>
  );
};
