import keytar from 'keytar';

export class KeyVault {
  async set(account: string, key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, account, key);
  }

  async get(account: string): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, account);
  }

  async delete(account: string): Promise<boolean> {
    return await keytar.deletePassword(SERVICE_NAME, account);
  }
}
