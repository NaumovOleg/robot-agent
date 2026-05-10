import React, { useMemo, useState } from 'react';
import { ProfileContext } from './ctx';
import type { Profile } from '@robocode-packages/shared';
import { ProfileConfig } from '@robocode-packages/core';

interface Props {
  children: React.ReactNode;
}

export const ProfileProvider: React.FC<Props> = ({ children }) => {
  const [profiles, setProfiles] = useState<Profile[]>(() => ProfileConfig.list());

  const add = async (profile: Omit<Profile, 'active' | 'id'>) => {
    await ProfileConfig.add(profile);
    setProfiles(ProfileConfig.list());
  };

  const del = (id: string) => {
    ProfileConfig.delete(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  };

  const set = (id: string) => {
    ProfileConfig.set(id);
    setProfiles((prev) => prev.map((p) => ({ ...p, active: p.id === id })));
  };

  const active = () => profiles.find((p) => p.active) ?? profiles[0];

  const list = () => profiles;

  const update = (partial: Partial<Profile>): Profile => {
    if (!partial.id) throw new Error('update requires id');

    const updated = profiles.find((p) => p.id === partial.id);
    if (!updated) throw new Error(`Profile ${partial.id} not found`);

    const next = { ...updated, ...partial };
    ProfileConfig.update(partial);
    setProfiles((prev) => prev.map((p) => (p.id === partial.id ? next : p)));

    return next;
  };

  const value = useMemo(
    () => ({ profile: active(), add, delete: del, set, active, list, update }),
    [profiles]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};
