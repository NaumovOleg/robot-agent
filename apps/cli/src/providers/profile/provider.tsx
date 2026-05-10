import React, { useMemo, useState } from 'react';
import { ProfileContext } from './ctx';
import type { Profile } from '@robocode-packages/shared';
import { ProfileConfig } from '@robocode-packages/core';

interface Props {
  children: React.ReactNode;
}

export const ProfileProvider: React.FC<Props> = ({ children }) => {
  const [profiles, setProfiles] = useState<Profile[]>(() => ProfileConfig.list());

  const add = (profile: Omit<Profile, 'active'>) => {
    setProfiles((prev) => {
      const updated = prev.map((p) => ({ ...p, active: false }));
      updated.push({ ...profile, active: true });
      ProfileConfig.add(profile);
      return updated;
    });
  };

  const del = (name: string) => {
    setProfiles((prev) => {
      const updated = prev.filter((p) => p.name !== name);
      ProfileConfig.delete(name);
      return updated;
    });
  };

  const set = (name: string) => {
    setProfiles((prev) => {
      const updated = prev.map((p) => ({ ...p, active: p.name === name }));
      ProfileConfig.set(name);
      return updated;
    });
  };

  const active = () => profiles.find((p) => p.active) ?? profiles[0];

  const list = () => profiles;

  const update = (partial: Partial<Profile>): Profile => {
    let updated!: Profile;
    setProfiles((prev) => {
      const next = prev.map((p) => {
        if (!p.active) return p;
        updated = { ...p, ...partial };
        return updated;
      });
      ProfileConfig.update(partial);
      return next;
    });

    return updated;
  };

  const value = useMemo(
    () => ({ profile: active(), add, delete: del, set, active, list, update }),
    [profiles]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};
