export * from './tools';
export * from './utils';
import { searchFilesTool } from './tools/reader';
import type { StructuredToolInterface } from '@langchain/core/tools';

import {
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  patchFileTool,
  globTool,
  grepTool,
  listDirTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBlameTool,
  gitShowTool,
  gitBranchTool,
  findDefinitionTool,
} from './tools';

export const ALL_TOOLS = [
  // Navigation
  listDirTool,
  readFileTool,
  searchFilesTool,
  findDefinitionTool,
  globTool,
  grepTool,
  // Editing
  editFileTool,
  patchFileTool,
  writeFileTool,
  // Executing
  bashTool,
  // git
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitBlameTool,
  gitShowTool,
  gitBranchTool,
];

export const createAgentTools = (...delegateTools: StructuredToolInterface[]) => [
  ...delegateTools,
];
