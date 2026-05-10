import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { Routes, Route } from '@types';

const NAV_ITEMS: { label: string; route: Route }[] = [
  { label: 'welcome', route: Routes.welcome },
  { label: 'assistant', route: Routes.assistant },
  { label: 'profile settings', route: Routes.profile },
  { label: 'settings', route: Routes.settings },
];

export const Navigation = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();

  const [focused, setFocused] = useState(false);
  const [navIndex, setNavIndex] = useState(NAV_ITEMS.findIndex((i) => i.route === route));

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useInput((input, key) => {
    if (key.ctrl && input === 'p') {
      setFocused(true);
      setNavIndex(NAV_ITEMS.findIndex((i) => i.route === route));
      return;
    }

    if (!focused) return;

    if (key.escape) {
      setFocused(false);
      return;
    }
    if (key.leftArrow) {
      setNavIndex((i) => Math.max(i - 1, 0));
    }
    if (key.rightArrow) {
      setNavIndex((i) => Math.min(i + 1, NAV_ITEMS.length - 1));
    }

    if (key.return) {
      const target = NAV_ITEMS[navIndex];
      if (target.route === 'assistant' && !activeProfile) return;
      navigate(target.route);
      setFocused(false);
    }
  });

  return (
    <Box
      borderStyle={focused ? 'round' : 'single'}
      borderColor={focused ? 'blueBright' : 'gray'}
      paddingX={1}
      gap={3}
    >
      {NAV_ITEMS.map((item, i) => {
        const isCurrent = route === item.route;
        const isHighlighted = focused && i === navIndex;
        const isDisabled = item.route === 'assistant' && !activeProfile;

        return (
          <Box key={item.route} gap={1}>
            {isHighlighted ? (
              <Text color="blueBright" bold>
                ▶ {item.label}
              </Text>
            ) : isCurrent ? (
              <Text color="white" bold>
                ● {item.label}
              </Text>
            ) : (
              <Text color={isDisabled ? 'gray' : 'gray'} dimColor>
                ○ {item.label}
              </Text>
            )}
            {isDisabled && (
              <Text color="gray" dimColor>
                (no profile)
              </Text>
            )}
          </Box>
        );
      })}

      <Box flexGrow={1} justifyContent="flex-end">
        {focused ? (
          <Text dimColor>←→ navigate ENTER confirm ESC cancel</Text>
        ) : (
          <Text dimColor>^P = navigate</Text>
        )}
      </Box>
    </Box>
  );
};
