import type { RootStateType } from '@robocode-packages/shared';
import { buildContext, jsonToXml } from '@robocode-packages/shared';
import { SystemMessage } from '@langchain/core/messages';
import { buildSystemPrompt } from '../prompts';

export const contextNode = async (state: RootStateType) => {
  const context = await buildContext(state);

  const ctx = jsonToXml(context, {
    omitEmpty: true,
    arrayConfigs: [
      { path: 'language.aliases', itemTag: 'alias' },
      { path: 'structure', itemTag: 'dir' },
      { path: 'git.recentCommits', itemTag: 'commit' },
      { path: 'git.staged', itemTag: 'file' },
      { path: 'git.unstaged', itemTag: 'file' },
      { path: 'project.frameworks', itemTag: 'framework' },
      { path: 'entryPoints', itemTag: 'entry' },
      { path: 'structure[].items', itemTag: 'dir' },
      { path: 'structure[].children', itemTag: 'dir' },
    ],
  });

  state.context = context;
  state.messages = [new SystemMessage(buildSystemPrompt(ctx))];

  // Reset per-run state so results/approval/clarification from a prior turn on
  // this session thread don't leak into this one (contextNode runs first on every
  // fresh invoke; resumes re-enter at the interrupted node and skip this reset).
  state.stepResults = [];
  state.planApproved = null;
  state.plan = null;
  state.router = { userRequests: [] };
  state.selectedFiles = [];
  state.answer = null;
  state.question = null;
  state.clarificationSource = null;

  return state;
};
