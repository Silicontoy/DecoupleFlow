import { useCallback, useEffect, useState } from 'react';
import type { Machine } from '../domain/types';
import type { RunRecord } from '../domain/runtime';
import type { RunSnapshot } from '../domain/live';
import { localRequest, type LocalInfo } from './files';

export function useLiveRun(machine: Machine, record: RunRecord, info: LocalInfo | null) {
  const [snapshot, updateSnapshot] = useState<RunSnapshot | null>(null);
  const setSnapshot = useCallback((next: RunSnapshot | null) => updateSnapshot(previous => {
    if (previous && next && previous.runId === next.runId && (next.events.at(-1)?.seq ?? 0) < (previous.events.at(-1)?.seq ?? 0)) return previous;
    return next;
  }), []);
  const [eventToken, setEventToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  useEffect(() => {
    if (!info) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(); setSnapshot(null); setEventToken('');
    const connect = async () => {
      try {
        const opened = await localRequest('/api/runs/open', { machine, record }, info, controller.signal);
        if (!active) return;
        setSnapshot(opened.snapshot); setEventToken(opened.eventToken);
        const response = await fetch('/api/runs/watch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': info.token }, body: JSON.stringify({ runId: record.instanceId }), signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('无法建立实例事件流。');
        setConnected(true); setConnectionError('');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
        try {
          while (active) {
            const item = await reader.read(); if (item.done) break;
            buffer += decoder.decode(item.value, { stream: true });
            let split: number;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.slice(0, split); buffer = buffer.slice(split + 2);
              if (message.startsWith('data: ') && active) setSnapshot(JSON.parse(message.slice(6)));
            }
          }
        } finally { reader.releaseLock(); }
        if (active) throw new Error('事件连接中断，正在重新连接。');
      } catch (error) {
        if (!active) return;
        setConnected(false); setConnectionError((error as Error).message);
        timer = setTimeout(() => void connect(), 1500);
      }
    };
    void connect();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [machine, record.instanceId, info]);
  return { snapshot: snapshot?.runId === record.instanceId ? snapshot : null, setSnapshot, eventToken, connected: connected && snapshot?.runId === record.instanceId, connectionError };
}
