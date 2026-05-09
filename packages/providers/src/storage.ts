import fs from 'node:fs';
import { CONFIG_PATH } from '@robocode-packages/config';

export interface Config {
  provider: 'openai' | 'anthropic';
  apiKey: string;
}

export function saveConfig(config: Config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function loadConfig(): Config | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}
