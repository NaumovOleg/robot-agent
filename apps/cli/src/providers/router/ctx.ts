import { createContext } from 'react';
import type { RouterState } from '@types';

export const RouterContext = createContext<RouterState | null>(null);
