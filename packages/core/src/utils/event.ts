import { EventEmitter } from 'node:events';
import type { AppEvents } from '@robocode-packages/shared';

export type AppEvent = keyof AppEvents;
export type AppEventPayload<E extends AppEvent> = AppEvents[E];

class TypedEventEmitter {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<E extends AppEvent>(event: E, payload: AppEventPayload<E>): void {
    this.emitter.emit(event, payload);
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
