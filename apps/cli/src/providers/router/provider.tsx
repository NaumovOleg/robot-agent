import React, { useMemo, useState } from 'react';

import { RouterContext } from './ctx';
import { Route } from '@types';

interface Props {
  children: React.ReactNode;
}

export const RouterProvider: React.FC<Props> = ({ children }) => {
  const [history, setHistory] = useState<Route[]>(['welcome']);

  const route = history.at(-1) ?? 'welcome';

  const push = (next: Route) => setHistory((prev) => [...prev, next]);

  const back = () => setHistory((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));

  const value = useMemo(
    () => ({
      route,
      push,
      back,
    }),
    [route]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};
