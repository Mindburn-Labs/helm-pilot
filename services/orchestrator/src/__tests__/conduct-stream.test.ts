import { afterEach, describe, expect, it } from 'vitest';
import {
  ConductEventStream,
  emitConductEvent,
  type ConductEvent,
} from '../conduct-stream.js';

// ─── ConductEventStream tests (Phase 14 Track L) ───

const streams: ConductEventStream[] = [];
afterEach(() => {
  for (const s of streams.splice(0)) {
    s.reset();
    s.close();
  }
});

function mk(): ConductEventStream {
  const s = new ConductEventStream();
  streams.push(s);
  return s;
}

describe('ConductEventStream', () => {
  it('delivers events to subscribers of the same taskId', () => {
    const s = mk();
    const received: ConductEvent[] = [];
    const off = s.subscribe('t-1', (e) => received.push(e));
    emitConductEvent({ type: 'iteration.started', taskId: 't-1', iteration: 1 }, s);
    emitConductEvent({ type: 'action.selected', taskId: 't-1', iteration: 1, tool: 'echo' }, s);
    off();
    expect(received.map((e) => e.type)).toEqual(['iteration.started', 'action.selected']);
    expect(received[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('isolates subscribers by taskId', () => {
    const s = mk();
    const a: ConductEvent[] = [];
    const b: ConductEvent[] = [];
    s.subscribe('task-a', (e) => a.push(e));
    s.subscribe('task-b', (e) => b.push(e));
    emitConductEvent({ type: 'task.verdict', taskId: 'task-a' }, s);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it('silent no-op when nobody is subscribed', () => {
    const s = mk();
    expect(() =>
      emitConductEvent({ type: 'iteration.started', taskId: 'ghost' }, s),
    ).not.toThrow();
    expect(s.activeTaskCount()).toBe(0);
  });

  it('unsubscribe tears down hub when last listener leaves', () => {
    const s = mk();
    const off = s.subscribe('t-x', () => {});
    expect(s.activeTaskCount()).toBe(1);
    off();
    expect(s.activeTaskCount()).toBe(0);
  });

  it('multiple subscribers on the same taskId all fire', () => {
    const s = mk();
    let seen = 0;
    s.subscribe('t-m', () => seen++);
    s.subscribe('t-m', () => seen++);
    emitConductEvent({ type: 'subagent.spawned', taskId: 't-m' }, s);
    expect(seen).toBe(2);
  });
});
