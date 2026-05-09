import { createContext, useContext } from 'react';
import type { RouterState } from '@types';

export const RouterContext = createContext<RouterState | null>(null);

export const useRouter = () => {
  const ctx = useContext(RouterContext);

  if (!ctx) {
    throw new Error('RouterContext missing');
  }

  return ctx;
};
