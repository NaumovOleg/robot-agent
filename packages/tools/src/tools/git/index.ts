export { gitBlameTool } from './blame';
export { gitBranchTool } from './branch';
export { gitDiffTool } from './diff';
export { gitLogTool } from './log';
export { gitShowTool } from './show';
export { gitStatusTool } from './status';
export { gitAddTool } from './add';
export { gitCommitTool } from './commit';
export { gitAmendTool } from './amend';
export { gitCheckoutBranchTool } from './checkoutBranch';
export { gitPushTool } from './push';
export { gitStashTool } from './stash';

import { gitBlameTool } from './blame';
import { gitBranchTool } from './branch';
import { gitDiffTool } from './diff';
import { gitLogTool } from './log';
import { gitShowTool } from './show';
import { gitStatusTool } from './status';
import { gitAddTool } from './add';
import { gitCommitTool } from './commit';
import { gitAmendTool } from './amend';
import { gitCheckoutBranchTool } from './checkoutBranch';
import { gitPushTool } from './push';
import { gitStashTool } from './stash';

export default {
  gitBlameTool, gitStatusTool, gitBranchTool, gitDiffTool, gitLogTool, gitShowTool,
  gitAddTool, gitCommitTool, gitAmendTool, gitCheckoutBranchTool, gitPushTool, gitStashTool,
};

export const GIT_READ_TOOLS_SET = [
  gitBlameTool, gitStatusTool, gitBranchTool, gitDiffTool, gitLogTool, gitShowTool,
];

export const GIT_WRITE_TOOLS_SET = [
  gitAddTool, gitCommitTool, gitAmendTool, gitCheckoutBranchTool, gitPushTool, gitStashTool,
];

export const GIT_TOOLS_SET = [...GIT_READ_TOOLS_SET, ...GIT_WRITE_TOOLS_SET];
