import { EventEmitter } from 'node:events';
import postgres from 'postgres';
import { createLogger } from '@helm-pilot/shared/logger';

const log = createLogger('event-bus');

export interface DbEvent {
  type: string;
  workspace_id: string | null;
  id?: string;
  status?: string;
  task_id?: string | null;
  updated_at?: string;
}

/**
 * Event bus that listens on Postgres LISTEN/NOTIFY and emits events in-process.
 *
 * Consumers (SSE handlers, websocket handlers) subscribe via `on()`.
 * A single persistent connection is dedicated to listening — does not share
 * with the main pool (LISTEN is stateful per-connection).
 */
export class EventBus extends EventEmitter {
  private client: postgres.Sql | null = null;

  constructor(private readonly databaseUrl: string) {
    super();
    this.setMaxListeners(100); // allow many concurrent SSE streams
  }

  /** Open the listener connection and subscribe to the channel. */
  async start(): Promise<void> {
    this.client = postgres(this.databaseUrl, {
      max: 1, // single dedicated connection
      idle_timeout: 0, // never idle out (we want persistent LISTEN)
      connect_timeout: 10,
      connection: { application_name: 'helm-pilot-event-bus' },
    });

    await this.client.listen(
      'helm_pilot_events',
      (payload: string) => {
        try {
          const event = JSON.parse(payload) as DbEvent;
          this.emit('event', event);
          if (event.workspace_id) {
            this.emit(`workspace:${event.workspace_id}`, event);
          }
        } catch (err) {
          log.warn({ err, payload }, 'Failed to parse pg notification');
        }
      },
      () => log.info('Subscribed to helm_pilot_events channel'),
    );
  }

  /**
   * Subscribe to events for a specific workspace.
   * Returns an unsubscribe function.
   */
  subscribeWorkspace(workspaceId: string, handler: (event: DbEvent) => void): () => void {
    const channel = `workspace:${workspaceId}`;
    this.on(channel, handler);
    return () => this.off(channel, handler);
  }

  /** Close the listener connection. */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
    this.removeAllListeners();
  }
}
