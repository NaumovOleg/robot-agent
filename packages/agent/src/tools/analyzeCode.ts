import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readerGraph } from '../main/subagents/reader';
import type { RunnableConfig } from '@langchain/core/runnables';
import { HumanMessage } from '@langchain/core/messages';

export const analyzeCodeTool = tool(
  async ({ task, files }: { task: string; files: string[] }, config?: RunnableConfig) => {
    const sessionId = (config?.configurable?.sessionId as string) ?? '';
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const result = await readerGraph.invoke(
      {
        messages: [new HumanMessage(task)],
        sessionId,
        cwd,
        task,
        focus: files,
        turnCount: 0,
        editIntentInputPayload: null,
      },
      { configurable: { sessionId, cwd } }
    );

    const output = result.editIntentInputPayload;
    if (!output) return JSON.stringify({ status: 'blocked', summary: 'Reader returned no output' });
    return JSON.stringify(output);
  },
  {
    name: 'analyze_code',
    description: `Deep code analysis using AST parsing and import graph traversal.
Returns: functions, classes, imports, cross-file references, key findings, and a suggested edit strategy.
Use for: cross-file refactors, rename operations, understanding complex dependencies.
Do NOT use for simple single-file reads — use read_file instead.`,
    schema: z.object({
      task: z.string().describe('What to investigate — be specific about what you need to know'),
      files: z.array(z.string()).describe('File paths to analyze (relative to cwd)'),
    }),
  }
);
