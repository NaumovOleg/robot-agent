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
  risk?: 'low' | 'medium' | 'high';
  files_affected?: string[];
  approved: boolean;
}

export enum TOOL_NAMES {
  edit_file = 'edit_file',
  search_files = 'search_files',
  replace_lines = 'replace_lines',
  bash = 'bash',
  glob = 'glob',
  write_file = 'write_file',
  read_file = 'read_file',
  grep = 'grep',
  list_dir = 'list_dir',
  git_status = 'git_status',
  git_diff = 'git_diff',
  git_log = 'git_log',
  git_blame = 'git_blame',
  git_show = 'git_show',
  git_branch = 'git_branch',
}
