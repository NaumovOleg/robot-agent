export const ROLE_COLORS: Record<string, string> = {
  human: 'green',
  ai: 'cyan',
  system: 'gray',
  tool: 'yellow',
};

export const ROLE_LABELS: Record<string, string> = {
  human: '  you',
  ai: '   ai',
  system: '  sys',
  tool: ' tool',
};

export interface Message {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string;
}
