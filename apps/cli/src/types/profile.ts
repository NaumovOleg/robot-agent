import type { Profile } from '@robocode-packages/shared';

export interface ProfileState {
  profile: Profile;
  add: (profile: Omit<Profile, 'active' | 'id'>) => void;
  delete: (name: string) => void;
  set: (name: string) => void;
  active: () => Profile;
  list: () => Profile[];
  update: (profile: Partial<Profile>) => Profile;
}
