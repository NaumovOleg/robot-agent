import { Command, END } from '@langchain/langgraph';

import { SessionService, Checkpointer, EventBus } from '@robocode-packages/core';
import type { Session, ModelOrGraph } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';

export class Agent<T extends ModelOrGraph> {
  readonly graphOrModel: T;
  static readonly name: string;

  get thread() {
    if (!this.session) {
      throw new Error('Session not set. Call setSession(sessionId) before running the agent.');
    }

    const agentName =
      (this as unknown as { name?: string }).name?.trim() || this.constructor.name || 'agent';

    return this.session.id + `_${agentName}`;
  }

  static instance: Agent<ModelOrGraph>;
  session?: Session | null = SessionService.findActive();

  get config() {
    return {
      configurable: { thread_id: this.thread, sessionId: this.session?.id, cwd: this.session?.cwd },
      recursionLimit: 200,
    };
  }

  constructor(graphOrModel: T) {
    this.graphOrModel = graphOrModel;
    EventBus.on('agent:set-session', this.setSession.bind(this));
    EventBus.on('agent:stop', this.stop.bind(this));
    EventBus.on('agent:delete-checkpoint', this.deleteCheckpoint.bind(this));
  }

  setSession(session: Session | null) {
    this.session = session;
  }

  public static getInstance(graph: ModelOrGraph) {
    if (!Agent.instance) {
      Agent.instance = new Agent(graph);
    }

    return Agent.instance;
  }

  async stop({ sessionId }: { sessionId: string }) {
    const config = { configurable: { thread_id: this.thread } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.graphOrModel.invoke(new Command({ goto: END as any }), config);
    EventBus.emit('agent:stopped', { sessionId });
  }

  async deleteCheckpoint() {
    try {
      const checkpointer = Checkpointer.getInstance();
      await checkpointer.deleteThread(this.thread);
      debug('[deleteSessionCheckpoint] deleted:', this.thread);
    } catch (err) {
      debug('[deleteSessionCheckpoint] error:', err);
    }
  }
}
