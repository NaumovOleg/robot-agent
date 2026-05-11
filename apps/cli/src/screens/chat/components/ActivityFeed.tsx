import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const getLabel = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return `$ ${String(args.command ?? '').slice(0, 60)}`;
  if (name === 'read_file') return String(args.path ?? '');
  if (name === 'edit_file') return String(args.path ?? '');
  if (name === 'write_file') return String(args.path ?? '');
  if (name === 'grep') return `/${String(args.pattern ?? '')}/`;
  if (name === 'glob') return String(args.pattern ?? '');
  if (name === 'list_dir') return String(args.path ?? '.');
  if (name === 'git_diff') return args.file ? String(args.file) : 'working tree';
  if (name === 'git_log') return args.file ? String(args.file) : '';
  if (name === 'git_blame') return String(args.file ?? '');
  return '';
};

interface Props {
  activities: ToolActivity[];
}

export const ActivityFeed: React.FC<Props> = ({ activities }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const hasRunning = activities.some((a) => a.status === 'running');
    if (!hasRunning) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [activities]);

  if (activities.length === 0) return null;

  const recent = activities.slice(-6);

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {recent.map((activity) => {
        const label = getLabel(activity.name, activity.input);

        if (activity.status === 'running') {
          return (
            <Box key={activity.id} gap={1}>
              <Text color="cyan">{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>
              <Text color="cyan">{activity.name}</Text>
              {label ? <Text color="gray">{label}</Text> : null}
            </Box>
          );
        }

        if (activity.status === 'error') {
          return (
            <Box key={activity.id} gap={1}>
              <Text color="red">✗</Text>
              <Text color="red" dimColor>
                {activity.name}
              </Text>
              {label ? (
                <Text color="gray" dimColor>
                  {label}
                </Text>
              ) : null}
            </Box>
          );
        }

        return (
          <Box key={activity.id} gap={1}>
            <Text color="green">✓</Text>
            <Text color="gray" dimColor>
              {activity.name}
            </Text>
            {label ? (
              <Text color="gray" dimColor>
                {label}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};
