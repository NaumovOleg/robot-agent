import type { CompiledGraphType } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Session } from './session';

export type ToolRisk = 'safe' | 'moderate' | 'destructive';
export type PlanRisk = 'low' | 'medium' | 'high';
export type PlanStepKind = 'inspect' | 'edit' | 'create' | 'delete';

export interface PlanStep {
  id: string;
  kind: PlanStepKind;
  title: string;
  files: string[];
  depends_on: string[];
  expected_output: string;
}

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  risk: ToolRisk;
  description: string;
  metadata?: {
    startLine?: number;
  };
}

export enum TOOL_NAMES {
  edit_file = 'edit_file',
  patch_file = 'patch_file',
  search_files = 'search_files',
  delegate_to_reader = 'delegate_to_reader',
  delegate_to_writer = 'delegate_to_writer',
  delegate_to_git = 'delegate_to_git',
  bash = 'bash',
  glob = 'glob',
  write_file = 'write_file',
  delete_file = 'delete_file',
  rename_file = 'rename_file',
  read_file = 'read_file',
  validate_project = 'validate_project',
  grep = 'grep',
  list_dir = 'list_dir',
  git_status = 'git_status',
  git_diff = 'git_diff',
  git_log = 'git_log',
  git_blame = 'git_blame',
  git_show = 'git_show',
  git_branch = 'git_branch',
  git_add = 'git_add',
  git_commit = 'git_commit',
  git_amend = 'git_amend',
  git_checkout_branch = 'git_checkout_branch',
  git_push = 'git_push',
  git_stash = 'git_stash',
  undo = 'undo',
  find_definition = 'find_definition',
  ast_analyzer = 'ast_analyzer',
  verify_edits = 'verify_edits',
}

export type ModelOrGraph = BaseChatModel | CompiledGraphType;

/**
 * Interface describing the Agent class
 */
export interface IAgent<T extends ModelOrGraph> {
  // Properties
  readonly graphOrModel: T;
  session?: Session | null;

  // Getters
  readonly thread: string;
  readonly config: RunnableConfig;

  // Methods
  setSession(session: Session | null): void;
  stop(params: { sessionId: string }): Promise<void>;
  deleteCheckpoint(): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...args: any[]): any;

  // Static (but interface describes instance side only)
  // For static part you'd need a separate constructor interface.
}

// If you need to include static methods (getInstance) in the type,
// you can define a constructor interface:
export interface AgentConstructor {
  new <T extends ModelOrGraph>(graphOrModel: T): IAgent<T>;
  getInstance<T extends ModelOrGraph>(graph: ModelOrGraph): IAgent<T>;
}

export interface SubagentOptions {
  maxTurns?: number;
  maxToolResultChars?: number;
  maxFinalChars?: number;
}
export type ClarificationSource = 'router' | 'planner' | 'executor';
