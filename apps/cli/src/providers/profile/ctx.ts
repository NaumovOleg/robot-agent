import { createContext } from 'react';
import type { ProfileState } from '@types';

export const ProfileContext = createContext<ProfileState | null>(null);
