import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ALL_TOOLS } from '@robocode-packages/tools';

export const toolsNode = new ToolNode(ALL_TOOLS);
