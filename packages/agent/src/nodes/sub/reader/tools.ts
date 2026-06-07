import { READER_TOOLS } from '@robocode-packages/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';

export const toolsNode = new ToolNode(READER_TOOLS);
