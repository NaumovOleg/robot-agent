import keytar from 'keytar';
import { SERVICE_NAME } from '@robocode-packages/config';

export class Vault {
  static async set(account: string, key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, account, key);
  }
  static async get(account: string): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, account);
  }

  static async delete(account: string): Promise<boolean> {
    return await keytar.deletePassword(SERVICE_NAME, account);
  }
}
