/**
 * Sentry integration — no-op if SENTRY_DSN is not set.
 *
 * Each service that wants error reporting calls `initSentry()` once at boot,
 * then calls `captureException()` or `captureMessage()` from its error handlers.
 *
 * Kept in a shared module so the same init/wrap functions are used across
 * gateway, orchestrator, and telegram-bot without duplicating logic.
 */

import { createLogger } from '../logger.js';

const log = createLogger('sentry');

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
}

let enabled = false;
let sentryModule: unknown = null;

/**
 * Initialize Sentry if SENTRY_DSN is set. Otherwise no-op.
 *
 * Call once per process at startup, before any other imports that may throw.
 */
export async function initSentry(config: SentryConfig = {}): Promise<void> {
  const dsn = config.dsn ?? process.env['SENTRY_DSN'];
  if (!dsn) {
    log.debug('SENTRY_DSN not set — error reporting disabled');
    return;
  }

  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: config.environment ?? process.env['NODE_ENV'] ?? 'development',
      release: config.release ?? process.env['RELEASE_VERSION'],
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
    });
    sentryModule = Sentry;
    enabled = true;

    // Capture global unhandled errors
    process.on('uncaughtException', (err) => {
      captureException(err, { tags: { source: 'uncaughtException' } });
    });
    process.on('unhandledRejection', (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      captureException(err, { tags: { source: 'unhandledRejection' } });
    });

    log.info({ environment: config.environment ?? process.env['NODE_ENV'] }, 'Sentry initialized');
  } catch (err) {
    log.warn({ err }, 'Sentry failed to initialize — error reporting disabled');
  }
}

export interface CaptureContext {
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string };
}

/**
 * Capture an exception. No-op if Sentry isn't initialized.
 */
export function captureException(error: unknown, context?: CaptureContext): void {
  if (!enabled || !sentryModule) return;
  try {
    const Sentry = sentryModule as {
      captureException: (err: unknown, ctx?: unknown) => void;
    };
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: context?.extra,
      user: context?.user,
    });
  } catch {
    // Never let reporting break the app
  }
}

/**
 * Capture a message (e.g., a handled warning worth tracking).
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: CaptureContext,
): void {
  if (!enabled || !sentryModule) return;
  try {
    const Sentry = sentryModule as {
      captureMessage: (msg: string, ctx?: unknown) => void;
    };
    Sentry.captureMessage(message, { level, tags: context?.tags, extra: context?.extra });
  } catch {
    // Never let reporting break the app
  }
}

/** Flush pending events before shutdown. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled || !sentryModule) return;
  try {
    const Sentry = sentryModule as { flush: (timeout: number) => Promise<boolean> };
    await Sentry.flush(timeoutMs);
  } catch {
    // ignore
  }
}
