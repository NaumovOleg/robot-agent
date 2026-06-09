import type { RootStateType } from '@robocode-packages/shared';
import { fileSelectorGraph } from '../../graphs/fileSelector';

export const fileSelectorNode = async (state: RootStateType) => {
  const { selectedFiles } = await fileSelectorGraph.invoke({
    cwd: state.cwd,
    keywords: state.router.intent?.keywords,
  });

  return { selectedFiles };
};
