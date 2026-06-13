import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Command, END } from '@langchain/langgraph';
import { rootGraph } from './graphs';
import {
  MessageService,
  SessionService,
  Checkpointer,
  EventBus,
  AuditService,
} from '@robocode-packages/core';
import type { Session } from '@robocode-packages/shared';
import { debug, getGitDiffPreview, getGitDiffStat } from '@robocode-packages/shared';
import { extractNewMessages, saveNewMessages } from './utils';
import { compactConversation } from './context/compressor';

class RoboAgent {
  private static instance: RoboAgent;
  private session?: Session | null = SessionService.findActive();
  private isRunning = false;
  private readonly unsubs: (() => void)[] = [];

  private getMainThreadId(sessionId?: string) {
    return `${sessionId ?? this.session?.id ?? ''}_main`;
  }

  // Prune the thread's checkpoints once a run has fully completed (no pending
  // interrupt), keeping the SQLite file bounded. Skipped mid-interrupt so the
  // resume checkpoint survives.
  private maybePruneThread(threadId: string, result: unknown): void {
    const interrupted = !!(result as { __interrupt__?: unknown })?.__interrupt__;
    if (!interrupted) Checkpointer.pruneThread(threadId);
  }

  // Resolves the session for a resume/answer. Falls back to the in-memory active
  // session when the on-disk index lookup misses — during a live run (e.g. an
  // executor escalation interrupt) the session is held in memory and may not be
  // reloadable from the index yet, which previously threw "Session not found".
  private resolveSession(sessionId: string): Session | null {
    const loaded = SessionService.load(sessionId);
    if (loaded) return loaded;
    if (this.session?.id === sessionId) return this.session;
    if (SessionService.active?.id === sessionId) return SessionService.active;
    return null;
  }

  private async publishGitDiff(sessionId: string, cwd: string) {
    const [gitDiffStat, gitDiffPreview] = await Promise.all([
      getGitDiffStat(cwd),
      getGitDiffPreview(cwd),
    ]);
    EventBus.emit('agent:git_diff', { sessionId, gitDiffStat, gitDiffPreview });
    return { gitDiffStat, gitDiffPreview };
  }

  constructor() {
    this.unsubs.push(EventBus.on('agent:set-session', (session) => this.setSession(session)));

    this.unsubs.push(
      EventBus.on('agent:run', (userInput) => {
        this.run(userInput).catch((err) => {
          const sid = this.session?.id ?? '';
          debug('[run] unhandled error:', err);
          if (sid) {
            EventBus.emit('llm:error', { sessionId: sid, error: String(err) });
            EventBus.emit('llm:end', { sessionId: sid });
          }
        });
      })
    );

    this.unsubs.push(
      EventBus.on('agent:resume', (params) => {
        this.resume(params).catch((err) => {
          debug('[resume] error:', err);
          EventBus.emit('llm:error', { sessionId: params.sessionId, error: String(err) });
          EventBus.emit('llm:end', { sessionId: params.sessionId });
        });
      })
    );

    this.unsubs.push(
      EventBus.on('agent:stop', (params) => {
        this.stop(params).catch((err) => debug('[stop] error:', err));
      })
    );

    this.unsubs.push(
      EventBus.on('agent:delete-checkpoint', (sessionId) => {
        this.deleteCheckpoint(sessionId).catch((err) => debug('[deleteCheckpoint] error:', err));
      })
    );

    this.unsubs.push(
      EventBus.on('agent:compact_request', (params) => {
        this.compact(params).catch((err) => debug('[compact] error:', err));
      })
    );

    this.unsubs.push(
      EventBus.on('agent:answer', (params) => {
        this.answerQuestion(params).catch((err) => {
          debug('[answerQuestion] error:', err);
          EventBus.emit('llm:error', { sessionId: params.sessionId, error: String(err) });
          EventBus.emit('llm:end', { sessionId: params.sessionId });
        });
      })
    );

    this.unsubs.push(
      EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
        AuditService.append(sessionId, 'agent:plan_pending', { plan });
      })
    );
    this.unsubs.push(
      EventBus.on('agent:plan_decision', ({ sessionId, approved, plan }) => {
        AuditService.append(sessionId, 'agent:plan_decision', { approved, plan });
      })
    );
    this.unsubs.push(
      EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
        AuditService.append(sessionId, 'agent:tool_pending', toolCall);
      })
    );
    this.unsubs.push(
      EventBus.on('agent:tool_decision', ({ sessionId, approved, toolCall }) => {
        AuditService.append(sessionId, 'agent:tool_decision', { approved, toolCall });
      })
    );
    this.unsubs.push(
      EventBus.on('llm:start', ({ sessionId }) => AuditService.append(sessionId, 'llm:start', {}))
    );
    this.unsubs.push(
      EventBus.on('llm:end', ({ sessionId }) => AuditService.append(sessionId, 'llm:end', {}))
    );
    this.unsubs.push(
      EventBus.on('llm:error', ({ sessionId, error }) =>
        AuditService.append(sessionId, 'llm:error', { error })
      )
    );
    this.unsubs.push(
      EventBus.on('tool:start', ({ sessionId, name, input, callId }) =>
        AuditService.append(sessionId, 'tool:start', { name, input, callId })
      )
    );
    this.unsubs.push(
      EventBus.on('tool:end', ({ sessionId, name, output, callId }) =>
        AuditService.append(sessionId, 'tool:end', { name, output, callId })
      )
    );
    this.unsubs.push(
      EventBus.on('tool:error', ({ sessionId, name, error, callId }) =>
        AuditService.append(sessionId, 'tool:error', { name, error, callId })
      )
    );
  }

  setSession(session: Session | null) {
    this.session = session;
  }

  public static getInstance() {
    if (!RoboAgent.instance) RoboAgent.instance = new RoboAgent();
    return RoboAgent.instance;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs.length = 0;
  }

  public async run(userRequest: string) {
    if (this.isRunning) {
      debug('[run] already running, dropping duplicate call');
      return;
    }
    this.isRunning = true;
    try {
      if (!this.session) throw new Error('Session not set');

      const { id: sessionId, cwd } = this.session;
      const config = {
        configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd },
        recursionLimit: 200,
      };

      const userMessage = new HumanMessage(userRequest);
      MessageService.add(sessionId, userMessage);
      AuditService.append(sessionId, 'agent:run', { input: userRequest });

      const result = await rootGraph.invoke({ messages: [], sessionId, cwd, userRequest }, config);
      this.maybePruneThread(config.configurable.thread_id, result);

      const diffPromise = this.publishGitDiff(sessionId, cwd);
      try {
        saveNewMessages(sessionId, result.messages ?? []);
      } finally {
        await diffPromise;
      }

      return { ...result, ...(await diffPromise) };
    } finally {
      this.isRunning = false;
    }
  }

  async resume(params: { sessionId: string; decision: 'approve' | 'reject' | 'y' | 'n' }) {
    const { sessionId, decision } = params;
    const session = this.resolveSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    AuditService.append(sessionId, 'agent:resume', { decision });

    const config = {
      configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd: session.cwd },
      recursionLimit: 200,
    };

    const historyBefore = MessageService.load(sessionId);
    const result = await rootGraph.invoke(new Command({ resume: decision }), config);
    this.maybePruneThread(config.configurable.thread_id, result);

    const resultMessages: BaseMessage[] = result.messages ?? [];
    const newMessages = extractNewMessages(historyBefore, resultMessages);
    debug('NEW MESSAGES after resume:', newMessages.length);
    saveNewMessages(sessionId, result.messages ?? []);

    return result;
  }

  async answerQuestion(params: { sessionId: string; answer: string }) {
    const { sessionId, answer } = params;
    const session = this.resolveSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    AuditService.append(sessionId, 'agent:answer', { answer });

    const config = {
      configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd: session.cwd },
      recursionLimit: 200,
    };

    const historyBefore = MessageService.load(sessionId);
    const result = await rootGraph.invoke(new Command({ resume: answer }), config);
    this.maybePruneThread(config.configurable.thread_id, result);

    const diffPromise = this.publishGitDiff(sessionId, session.cwd);
    try {
      const resultMessages: BaseMessage[] = result.messages ?? [];
      const newMessages = extractNewMessages(historyBefore, resultMessages);
      debug('NEW MESSAGES after answerQuestion:', newMessages.length);
      saveNewMessages(sessionId, result.messages ?? []);
    } finally {
      await diffPromise;
    }

    return { ...result, ...(await diffPromise) };
  }

  async stop({ sessionId }: { sessionId: string }) {
    const config = { configurable: { thread_id: this.getMainThreadId(sessionId) } };
    AuditService.append(sessionId, 'agent:stop', {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await rootGraph.invoke(new Command({ goto: END as any }), config);
    EventBus.emit('agent:stopped', { sessionId });
  }

  async deleteCheckpoint(sessionId: string) {
    try {
      const checkpointer = Checkpointer.getInstance();
      await checkpointer.deleteThread(this.getMainThreadId(sessionId));
    } catch (err) {
      debug('[deleteCheckpoint] error:', err);
    }
  }

  async compact({ sessionId }: { sessionId: string }) {
    const messages = MessageService.load(sessionId);
    const originalCount = messages.length;
    EventBus.emit('llm:start', { sessionId });
    try {
      const summaryMsg = await compactConversation(messages);
      MessageService.clear(sessionId);
      MessageService.add(sessionId, summaryMsg);
      EventBus.emit('agent:compact_complete', { sessionId, originalCount });
    } catch (err) {
      EventBus.emit('llm:error', { sessionId, error: String(err) });
    } finally {
      EventBus.emit('llm:end', { sessionId });
    }
  }
}

export const runAgent = RoboAgent.getInstance();
export { rootGraph, buildGraph } from './graphs';

export { canResume } from './utils';
