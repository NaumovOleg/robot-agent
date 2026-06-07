import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { EventBus } from '@robocode-packages/core';
import { TOOL_NAMES } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const bashTool = tool(
  async ({ command }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const sessionId = config?.configurable?.sessionId as string | undefined;
    const callId = config?.configurable?.toolCallId as string | undefined;
    const timeoutMs = 30_000;

    return await new Promise<string>((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const pushChunk = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (!text) return;

        if (stream === 'stdout') {
          stdout += text;
        } else {
          stderr += text;
        }

        if (sessionId) {
          EventBus.emit('tool:stream', {
            sessionId,
            name: TOOL_NAMES.bash,
            chunk: text,
            stream,
            callId,
          });
        }
      };

      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        const message = `Error: command timed out after ${timeoutMs}ms`;
        if (sessionId) {
          EventBus.emit('tool:stream', {
            sessionId,
            name: TOOL_NAMES.bash,
            chunk: `${message}\n`,
            stream: 'stderr',
            callId,
          });
        }
        stderr += `${message}\n`;
        finish(stderr.trim() || message);
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => pushChunk('stdout', chunk));
      child.stderr?.on('data', (chunk) => pushChunk('stderr', chunk));

      child.on('error', (err) => {
        clearTimeout(timer);
        finish(`Error: ${err.message}`);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
        if (code === 0) {
          finish(output || '(no output)');
          return;
        }

        const exitMessage = `Error: command exited with code ${code}`;
        finish(output ? `${exitMessage}\n${output}` : exitMessage);
      });
    });
  },
  {
    name: TOOL_NAMES.bash,
    description: 'Execute a bash command in the project directory.',
    schema: z.object({ command: z.string().describe('The bash command to execute') }),
  }
);
