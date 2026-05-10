import { useContext } from 'react';
import { RouterContext } from '@providers';

export const useRouter = () => {
  const ctx = useContext(RouterContext);

  if (!ctx) {
    throw new Error('RouterContext missing');
  }

  return ctx;
};
