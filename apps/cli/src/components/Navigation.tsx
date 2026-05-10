import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { Routes, Route } from '@types';

const NAV_ITEMS: { label: string; route: Route; shortcut: string }[] = [
  { label: 'welcome', route: Routes.welcome, shortcut: '1' },
  { label: 'assistant', route: Routes.assistant, shortcut: '2' },
  { label: 'profile settings', route: Routes.profile, shortcut: '3' },
  { label: 'settings', route: Routes.settings, shortcut: '4' },
];

export const Navigation = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;
  const currentIndex = NAV_ITEMS.findIndex((i) => i.route === route);

  const isAllowed = (r: Route) => {
    if (r === Routes.assistant && !activeProfile) return false;
    return true;
  };

  const goNext = () => {
    for (let step = 1; step <= NAV_ITEMS.length; step++) {
      const next = NAV_ITEMS[(currentIndex + step) % NAV_ITEMS.length]!;
      if (isAllowed(next.route)) {
        navigate(next.route);
        return;
      }
    }
  };

  const goPrev = () => {
    for (let step = 1; step <= NAV_ITEMS.length; step++) {
      const prev = NAV_ITEMS[(currentIndex - step + NAV_ITEMS.length) % NAV_ITEMS.length]!;
      if (isAllowed(prev.route)) {
        navigate(prev.route);
        return;
      }
    }
  };

  useInput((input, key) => {
    if (key.shift && key.tab) {
      goPrev();
      return;
    }
    if (key.tab) {
      goNext();
      return;
    }

    if (route !== Routes.welcome) {
      const num = parseInt(input);
      if (num >= 1 && num <= NAV_ITEMS.length) {
        const target = NAV_ITEMS[num - 1]!;
        if (!isAllowed(target.route)) return;
        navigate(target.route);
        return;
      }
    }
  });

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} gap={2}>
      {NAV_ITEMS.map((item) => {
        const isCurrent = route === item.route;
        const isDisabled = !isAllowed(item.route);

        return (
          <Box key={item.route} gap={1}>
            <Text color="gray" dimColor>
              [{item.shortcut}]
            </Text>
            {isCurrent ? (
              <Text color="blueBright" bold>
                {item.label}
              </Text>
            ) : isDisabled ? (
              <Text color="gray" dimColor>
                {item.label}
              </Text>
            ) : (
              <Text color="gray">{item.label}</Text>
            )}
          </Box>
        );
      })}

      <Box flexGrow={1} justifyContent="flex-end">
        <Text dimColor>TAB/1-4 navigate</Text>
      </Box>
    </Box>
  );
};
