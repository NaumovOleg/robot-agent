import {
  detectLanguages,
  getDirectoryTree,
  findEntryPoints,
  detectFrameworks,
  detectProjectName,
  cleanContext,
} from './utils';
import type { WorkspaceContext } from '../../types';
import { buildLanguageContext } from './language';
import { buildGitContext } from './git';

export const buildContext = async (state: { cwd: string }): Promise<WorkspaceContext> => {
  const { cwd } = state;

  // detect languages first — everything else depends on it
  const langs = await detectLanguages(cwd);

  const [git, language, structure, entryPoints, frameworks, name] = await Promise.all([
    buildGitContext(cwd),
    buildLanguageContext(cwd),
    getDirectoryTree(cwd, 2),
    findEntryPoints(cwd, langs),
    detectFrameworks(cwd, langs),
    detectProjectName(cwd, langs),
  ]);

  return cleanContext({
    cwd,
    git,
    language,
    project: { name, frameworks },
    structure,
    entryPoints,
  });
};
