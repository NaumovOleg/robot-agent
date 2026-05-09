import os from 'node:os';
import path from 'node:path';

export const SERVICE = 'robocode';
export const CONFIG_PATH = path.join(os.homedir(), '.robocode-config.json');

export type PROVIDERS = 'openai' | 'anthropic' | 'google' | 'openrouter' | 'groq' | 'ollama';

export enum API_KEYS {
  openai = 'openai:api-key',
}
