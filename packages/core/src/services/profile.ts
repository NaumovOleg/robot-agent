import { PROFILES_PATH } from '@robocode-packages/config';
import type { Profile } from '@robocode-packages/shared';
import { FileSystem, Vault, profileApiKey } from '@robocode-packages/shared';

export class ProfileConfig {
  static readonly profiles_config_path = PROFILES_PATH;
  static list() {
    return FileSystem.loadJson<Profile[]>(this.profiles_config_path) ?? [];
  }

  static readonly add = (profile: Omit<Profile, 'active'>): void => {
    const profiles = this.list().map((p) => ({ ...p, active: false }));
    const { apiKey, ...data } = profile;
    profiles.push({ ...data, apiKey: '', active: true });

    Vault.set(profileApiKey(profile.name), apiKey);
    return FileSystem.writeJson(profiles, this.profiles_config_path);
  };

  static readonly update = (profile: Partial<Profile>): void => {
    const profiles = this.list().map((p) => {
      if (profile.active) {
        p.active = false;
      }
      if (p.name === profile.name) {
        p = { ...p, ...profile };
      }
      return p;
    });

    return FileSystem.writeJson(profiles, this.profiles_config_path);
  };

  static readonly set = (name: string): void => {
    return this.update({ name, active: true });
  };

  static readonly active = (): Profile => {
    const list = this.list();
    return list.find((p) => p.active) ?? list[0];
  };

  static readonly delete = (name: string) => {
    const list = this.list().filter((p) => p.name !== name);
    return FileSystem.writeJson(list, this.profiles_config_path);
  };
}
