import { Agent } from '../../base';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { CompiledGraphType } from '@langchain/langgraph';
import type { IAgent, ReaderSubagentOptions, ReaderInput } from '@robocode-packages/shared';
import { EventBus } from '@robocode-packages/core';
import { readerGraph } from './graph';
import { initializeReaderSystemMessage } from '../../../utils';

export type ReaderTool = StructuredToolInterface;

export class ReaderAgent extends Agent<CompiledGraphType> implements IAgent<CompiledGraphType> {
  name = 'reader';
  options?: ReaderSubagentOptions;
  static instance: ReaderAgent;
  constructor(model: CompiledGraphType, options?: ReaderSubagentOptions) {
    super(model);
    this.options = options;
    EventBus.on('agent:set-session', this.setSession.bind(this));
    EventBus.on('agent:delete-checkpoint', this.deleteCheckpoint.bind(this));
    EventBus.on('agent:stop', this.stop.bind(this));
  }

  public async run(params: ReaderInput & { config?: RunnableConfig }) {
    if (!this.session) {
      throw new Error('Session not set. Call setSession(sessionId) before running the agent.');
    }

    const runtimeConfig = params.config
      ? {
          ...params.config,
          configurable: { ...this.config.configurable, ...params.config.configurable },
        }
      : this.config;

    const msg = await initializeReaderSystemMessage(params, {
      cwd: this.session?.cwd,
      sessionId: this.session.id,
    });
    return this.graphOrModel.invoke(
      {
        messages: [msg],
        sessionId: this.session.id,
        cwd: this.session?.cwd,
        task: params.task,
        focus: params.focus ?? [],
        user_goal: params.user_goal,
        current_plan_step: params.current_plan_step,
        instructions: params.instructions,
        turnCount: 0,
        editIntentInputPayload: null,
      },
      runtimeConfig
    );
  }

  public static getInstance(model: CompiledGraphType, options?: ReaderSubagentOptions) {
    if (!ReaderAgent.instance) {
      ReaderAgent.instance = new ReaderAgent(model, options);
    }

    return ReaderAgent.instance;
  }
}

export const readerAgent = ReaderAgent.getInstance(readerGraph);

export { readerGraph } from './graph';
export * from './state';
