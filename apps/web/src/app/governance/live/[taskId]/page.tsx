'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// ─── Live conduct stream viewer (Phase 14 Track L) ───
//
// Subscribes to /api/events/conduct/:taskId via EventSource and renders
// every conductor event as it arrives. No polling, no framework — just
// the browser-native SSE API.

interface ConductEvent {
  type: string;
  taskId: string;
  iteration?: number;
  tool?: string;
  verdict?: string;
  payload?: unknown;
  timestamp: string;
}

const TYPE_EMOJI: Record<string, string> = {
  'iteration.started': '◦',
  'action.selected': '→',
  'action.completed': '✓',
  'action.denied': '⨯',
  'action.approval_required': '⧖',
  'subagent.spawned': '⤷',
  'subagent.completed': '↩',
  'task.verdict': '■',
};

export default function LiveConductPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;
  const [events, setEvents] = useState<ConductEvent[]>([]);
  const [state, setState] = useState<'connecting' | 'open' | 'closed' | 'error'>(
    'connecting',
  );
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!taskId) return;
    const url = `/api/events/conduct/${encodeURIComponent(taskId)}`;
    const es = new EventSource(url);
    setState('connecting');

    es.addEventListener('subscribed', () => setState('open'));
    es.addEventListener('error', () => setState('error'));

    const types = Object.keys(TYPE_EMOJI);
    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as ConductEvent;
        setEvents((prev) => [...prev, parsed].slice(-500));
      } catch {
        /* ignore malformed */
      }
    };
    for (const t of types) es.addEventListener(t, handler);

    return () => {
      es.close();
      setState('closed');
    };
  }, [taskId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [events]);

  if (!taskId) return <main style={{ padding: 24 }}>No taskId.</main>;

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Live conduct</h1>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>
        Task <code>{taskId}</code> — stream state:{' '}
        <span style={{ textTransform: 'uppercase' }}>{state}</span>
      </p>
      <ul
        ref={listRef}
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          maxHeight: '70vh',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
        }}
      >
        {events.length === 0 ? (
          <li style={{ padding: 24, opacity: 0.6 }}>
            Waiting for events. Run a conduct against this task id to see live
            iterations.
          </li>
        ) : (
          events.map((ev, i) => (
            <li
              key={`${ev.timestamp}-${i}`}
              style={{
                padding: '8px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 13,
                display: 'grid',
                gridTemplateColumns: '24px 220px 80px 1fr',
                columnGap: 12,
                alignItems: 'baseline',
              }}
            >
              <span>{TYPE_EMOJI[ev.type] ?? '·'}</span>
              <span style={{ opacity: 0.8 }}>{ev.type}</span>
              <span style={{ opacity: 0.6 }}>
                {ev.iteration != null ? `iter ${ev.iteration}` : ''}
              </span>
              <span>
                {ev.tool ? <code>{ev.tool}</code> : null}
                {ev.payload ? (
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>
                    {JSON.stringify(ev.payload)}
                  </span>
                ) : null}
              </span>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
