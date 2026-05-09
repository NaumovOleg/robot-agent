import { z } from 'zod';

// Tool Input Schemas
export const ReadFileInputSchema = z.object({
  path: z.string(),
});

export const WriteFileInputSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export const ExecCommandInputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  options: z
    .object({
      cwd: z.string().optional(),
      env: z.record(z.string()).optional(),
    })
    .optional(),
});

// Tool Interfaces
export interface Tool<Input, Output> {
  name: string;
  inputSchema: z.ZodType<Input>;
  execute(input: Input): AsyncIterable<Output> | Promise<Output>;
}

// Tool Registry
export class ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();

  registerTool<Input, Output>(tool: Tool<Input, Output>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name ${tool.name} already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): Tool<any, any> | undefined {
    return this.tools.get(name);
  }

  async *invokeTool<Input, Output>(name: string, input: Input): AsyncIterable<Output> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool with name ${name} not found`);
    }
    const parsedInput = tool.inputSchema.parse(input);
    const result = tool.execute(parsedInput);
    if (Symbol.asyncIterator in result) {
      for await (const chunk of result as AsyncIterable<Output>) {
        yield chunk;
      }
    } else {
      yield (await result) as Output;
    }
  }
}

// Example Tools
export const readFileTool: Tool<{ path: string }, string> = {
  name: 'readFile',
  inputSchema: ReadFileInputSchema,
  async *execute(input) {
    const fs = await import('fs/promises');
    const content = await fs.readFile(input.path, 'utf-8');
    yield content;
  },
};

export const writeFileTool: Tool<{ path: string; content: string }, void> = {
  name: 'writeFile',
  inputSchema: WriteFileInputSchema,
  async *execute(input) {
    const fs = await import('fs/promises');
    await fs.writeFile(input.path, input.content, 'utf-8');
    yield;
  },
};

export const execCommandTool: Tool<
  { command: string; args?: string[]; options?: { cwd?: string; env?: Record<string, string> } },
  string
> = {
  name: 'execCommand',
  inputSchema: ExecCommandInputSchema,
  async *execute(input) {
    const { spawn } = await import('child_process');
    const child = spawn(input.command, input.args ?? [], {
      cwd: input.options?.cwd,
      env: { ...process.env, ...input.options?.env },
      shell: true,
    });

    for await (const chunk of streamChildProcess(child)) {
      yield chunk;
    }
  },
};

// Helper to stream child process stdout and stderr
async function* streamChildProcess(
  child: import('child_process').ChildProcessWithoutNullStreams
): AsyncIterable<string> {
  const stdout = child.stdout;
  const stderr = child.stderr;

  const stdoutIterator = streamToAsyncIterator(stdout);
  const stderrIterator = streamToAsyncIterator(stderr);

  const merged = mergeAsyncIterators(stdoutIterator, stderrIterator);

  yield* merged;
}

async function* streamToAsyncIterator(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  for await (const chunk of stream) {
    yield chunk.toString();
  }
}

async function* mergeAsyncIterators(...iterators: AsyncIterable<string>[]): AsyncIterable<string> {
  const readers = iterators.map((it) => it[Symbol.asyncIterator]());
  const results = await Promise.all(readers.map((r) => r.next()));

  while (true) {
    let doneCount = 0;
    for (let i = 0; i < readers.length; i++) {
      if (results[i].done) {
        doneCount++;
        continue;
      }
      yield results[i].value;
      results[i] = await readers[i].next();
    }
    if (doneCount === readers.length) {
      break;
    }
  }
}

// Example usage
const registry = new ToolRegistry();
registry.registerTool(readFileTool);
registry.registerTool(writeFileTool);
registry.registerTool(execCommandTool);

async function example() {
  // Invoke readFile
  for await (const content of registry.invokeTool('readFile', { path: './README.md' })) {
    console.log('Read file content:', content);
  }

  // Invoke writeFile
  for await (const _ of registry.invokeTool('writeFile', {
    path: './temp.txt',
    content: 'Hello World',
  })) {
    console.log('Wrote to file');
  }

  // Invoke execCommand
  for await (const output of registry.invokeTool('execCommand', {
    command: 'echo',
    args: ['Hello from execCommand'],
  })) {
    console.log('Command output:', output);
  }
}

// Run example if this module is main
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}
