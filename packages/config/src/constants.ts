import os from 'node:os';
import path from 'node:path';

export const SERVICE = 'robocode';
export const ROOT_DIR = path.join(os.homedir(), '.robocode');
export const CONFIG_PATH = path.join(ROOT_DIR, '.config.json');
export const PROFILES_PATH = path.join(ROOT_DIR, '.profiles.json');
export const SERVICE_NAME = 'robocode';
export const SESSIONS_DIR_PATH = path.join('.robocode', './sessions');
export const SESSION_INDEX_PATH = path.join('.robocode', 'index.json');

export enum AI_PROVIDERS {
  'openai' = 'openai',
  'anthropic' = 'anthropic',
  'google' = 'google',
  'openrouter' = 'openrouter',
  'groq' = 'groq',
  'ollama' = 'ollama',
}
export const PROVIDERS_LIST = Object.values(AI_PROVIDERS);

export enum API_KEYS {
  openai = 'openai:api-key',
  anthropic = 'anthropic:api-key',
  google = 'google:api-key',
  openrouter = 'openrouter:api-key',
  groq = 'groq:api-key',
  ollama = 'ollama:api-key',
}
