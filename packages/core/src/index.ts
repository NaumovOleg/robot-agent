import { EventEmitter } from 'node:events';
import { z } from 'zod';

// Event Bus
export class EventBus {
  private emitter = new EventEmitter();

  on<T extends string | symbol>(event: T, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  off<T extends string | symbol>(event: T, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<T extends string | symbol>(event: T, ...args: any[]): void {
    this.emitter.emit(event, ...args);
  }
}

// Logger
export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, ...args: unknown[]): void {
    console.info(message, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    console.warn(message, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
  }
  debug(message: string, ...args: unknown[]): void {
    console.debug(message, ...args);
  }
}

// Config Loader
const ConfigSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error('Invalid configuration');
  }
  return result.data;
}

// Base Abstractions
export interface Disposable {
  dispose(): Promise<void> | void;
}

export abstract class BaseService implements Disposable {
  abstract start(): Promise<void> | void;
  abstract stop(): Promise<void> | void;
  async dispose(): Promise<void> {
    await this.stop();
  }
}
