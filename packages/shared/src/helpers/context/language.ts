import type { LanguageContext } from '../../types';
import { LANG_SIGNATURES } from '@robocode-packages/config';
import {
  detectLanguages,
  detectLinter,
  detectBuildTool,
  detectTestRunner,
  detectPackageManager,
  buildModuleResolution,
} from './utils';
import path from 'node:path';
import { fileExists } from '../../utils';

export const buildLanguageContext = async (cwd: string): Promise<LanguageContext> => {
  const all = await detectLanguages(cwd);
  const primary = all[0] ?? 'unknown';

  const configFiles = (
    await Promise.all(
      LANG_SIGNATURES.map(async ({ files }) => {
        const found = await Promise.all(
          files
            .filter((f) => !f.includes('*'))
            .map(async (f) => {
              return (await fileExists(path.join(cwd, f))) ? f : null;
            })
        );
        return found.filter(Boolean) as string[];
      })
    )
  ).flat();

  const [linter, buildTool, testRunner, packageManager, moduleResolution] = await Promise.all([
    detectLinter(cwd, primary),
    detectBuildTool(cwd, primary),
    detectTestRunner(cwd, primary),
    detectPackageManager(cwd),
    buildModuleResolution(cwd, all),
  ]);

  return {
    primary,
    all,
    configFiles,
    linter,
    buildTool,
    testRunner,
    packageManager,
    moduleResolution,
  };
};
