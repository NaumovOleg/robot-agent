import { PROFILES_PATH } from '@robocode-packages/config';
import type { Profile } from '@robocode-packages/shared';
import { FileSystem, Vault, profileApiKey, normalizeProfile } from '@robocode-packages/shared';
import crypto from 'node:crypto';

export class ProfileConfig {
  static readonly profiles_config_path = PROFILES_PATH;
  static list() {
    return (FileSystem.loadJson<Profile[]>(this.profiles_config_path) ?? []).map((profile) =>
      normalizeProfile(profile)
    );
  }

  static async add({ apiKey, ...data }: Omit<Profile, 'active' | 'id'>) {
    const profiles = this.list().map((p) => ({ ...p, active: false }));
    const profile = normalizeProfile({
      ...data,
      active: true,
      id: crypto.randomUUID(),
      apiKey: '',
    });
    profiles.push(profile);

    await Vault.set(profileApiKey(profile.id), apiKey ?? 'apikey');
    FileSystem.writeJson(this.profiles_config_path, profiles);
    return profile;
  }

  static update(profile: Partial<Profile>) {
    const profiles = this.list().map((p) => {
      if (profile.active) {
        p.active = false;
      }
      if (p.name === profile.name || p.id === profile.id) {
        p = normalizeProfile({ ...p, ...profile } as Profile);
      }
      return p;
    });

    FileSystem.writeJson(this.profiles_config_path, profiles);
    return profile;
  }

  static set(id: string) {
    return this.update({ id, active: true });
  }

  static active(): Profile {
    const list = this.list();
    return list.find((p) => p.active) ?? list[0];
  }

  static delete(id: string) {
    const list = this.list().filter((p) => p.id !== id);
    if (list.length === 0) {
      FileSystem.writeJson(this.profiles_config_path, list);
      return list;
    }

    const active = list.find((el) => el.active);
    if (!active) {
      list[0] = { ...list[0], active: true };
    }

    FileSystem.writeJson(this.profiles_config_path, list);
    return list;
  }
}
