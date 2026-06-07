import { EventEmitter } from 'node:events';
import type { AppEvents } from '@robocode-packages/shared';

export type AppEvent = keyof AppEvents;
export type AppEventPayload<E extends AppEvent> = AppEvents[E];

interface PatternListener {
  regex: RegExp;
  listener: (event: string, payload: unknown) => void;
}

class TypedEventEmitter {
  private readonly emitter = new EventEmitter();
  private readonly patternListeners: PatternListener[] = [];

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  private dispatchToPatternListeners(event: string, payload: unknown): void {
    for (const { regex, listener } of this.patternListeners) {
      if (regex.test(event)) listener(event, payload);
    }
  }

  emit<E extends AppEvent>(event: E, payload: AppEventPayload<E>): void {
    this.emitter.emit(event, payload);
    this.dispatchToPatternListeners(event, payload);
  }

  // Emit with a dynamic (non-typed) event name — use for pattern-convention events.
  emitDynamic(event: string, payload: unknown): void {
    this.emitter.emit(event, payload);
    this.dispatchToPatternListeners(event, payload);
  }

  // Subscribe to events matching a glob pattern. * matches one colon-delimited segment.
  // Example: 'agent:clarification:*:question' matches 'agent:clarification:router-intent:question'
  onPattern(
    pattern: string,
    listener: (event: string, payload: unknown) => void
  ): () => void {
    const escaped = pattern
      .replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
      .replaceAll('*', '[^:]+');
    const regex = new RegExp(`^${escaped}$`);
    const entry: PatternListener = { regex, listener };
    this.patternListeners.push(entry);
    return () => {
      const idx = this.patternListeners.indexOf(entry);
      if (idx !== -1) this.patternListeners.splice(idx, 1);
    };
  }

  on<E extends AppEvent>(event: E, listener: (payload: AppEventPayload<E>) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  once<E extends AppEvent>(event: E, listener: (payload: AppEventPayload<E>) => void): void {
    this.emitter.once(event, listener);
  }

  off<E extends AppEvent>(event: E, listener: (payload: AppEventPayload<E>) => void): void {
    this.emitter.off(event, listener);
  }
}

export const EventBus = new TypedEventEmitter();
