import { useContext } from 'react';
import { SessionContext } from '@providers';

export const useSession = () => {
  const ctx = useContext(SessionContext);

  if (!ctx) {
    throw new Error('SessionContext missing');
  }

  return ctx;
};
