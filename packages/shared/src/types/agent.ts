export type ToolRisk = 'safe' | 'moderate' | 'destructive';

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  description: string;
}

export interface Plan {
  goal: string;
  steps: string[];
  approved: boolean;
}
