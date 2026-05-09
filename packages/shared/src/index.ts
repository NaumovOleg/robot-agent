// Shared Types
export type UUID = string;

export interface KeyValue {
  [key: string]: unknown;
}

// Utility Functions
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

// Constants
export const APP_NAME = "AI CLI Platform";
export const DEFAULT_TIMEOUT_MS = 30000;
