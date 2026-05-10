import { useContext } from 'react';
import { ProfileContext } from '@providers';

export const useProfile = () => {
  const ctx = useContext(ProfileContext);

  if (!ctx) {
    throw new Error('ProfileContext missing');
  }

  return ctx;
};
