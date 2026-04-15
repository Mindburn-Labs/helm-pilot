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
 *
 * Reconnects automatically with exponential backoff on any connection failure.
 * Emits `reconnected` when listener is restored — consumers may optionally
 * re-fetch state to cover missed events.
 */
export class EventBus extends EventEmitter {
  private client: postgres.Sql | null = null;
  private connected = false;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;

  constructor(private readonly databaseUrl: string) {
    super();
    this.setMaxListeners(100); // allow many concurrent SSE streams
  }

  /** True when the LISTEN connection is currently healthy. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Open the listener connection and subscribe to the channel. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    try {
      this.client = postgres(this.databaseUrl, {
        max: 1,
        idle_timeout: 0,
        connect_timeout: 10,
        connection: { application_name: 'helm-pilot-event-bus' },
        onnotice: () => {}, // suppress notices
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
        () => {
          this.connected = true;
          const wasReconnect = this.reconnectAttempt > 0;
          this.reconnectAttempt = 0;
          if (wasReconnect) {
            log.info('Event bus reconnected');
            this.emit('reconnected');
          } else {
            log.info('Subscribed to helm_pilot_events channel');
          }
        },
      );

      // postgres.js emits 'end' if the underlying connection dies; we can't
      // directly hook it on the client object, so we use a ping watchdog.
      this.startWatchdog();
    } catch (err) {
      this.connected = false;
      log.error({ err, attempt: this.reconnectAttempt }, 'Event bus connect failed');
      this.scheduleReconnect();
    }
  }

  /** Poll the LISTEN connection every 30s; on failure, schedule reconnect. */
  private startWatchdog(): void {
    const interval = setInterval(() => {
      if (this.stopped || !this.client) {
        clearInterval(interval);
        return;
      }
      // Lightweight health ping — SELECT 1 on the listener connection
      this.client.unsafe('SELECT 1').then(
        () => {
          this.connected = true;
        },
        (err) => {
          log.warn({ err }, 'Event bus watchdog ping failed');
          this.connected = false;
          clearInterval(interval);
          this.scheduleReconnect();
        },
      );
    }, 30_000);
    interval.unref();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    // Close the broken client before retrying
    if (this.client) {
      this.client.end({ timeout: 1 }).catch(() => {});
      this.client = null;
    }

    // Exponential backoff: 1s, 2s, 5s, 10s, 30s (capped)
    const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
    const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)]!;
    this.reconnectAttempt++;
    log.warn({ delay, attempt: this.reconnectAttempt }, 'Event bus scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
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
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
    this.connected = false;
    this.removeAllListeners();
  }
}
