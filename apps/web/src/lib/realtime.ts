import { createContext, createElement, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Realtime client (T-208, FR-3.9). One WebSocket per workspace to /v1/realtime. Server pushes ids-only invalidations;
 * we refetch through the API (RLS stays the gate). Reconnects with exponential backoff and refetches everything after
 * a reconnect (events may have been missed). While offline, queries fall back to polling (see `isLive`).
 */
export type RealtimeStatus = "connecting" | "live" | "offline";
export interface Viewer { user_id: string; name: string; state: "viewing" | "typing" }

// Module-level live flag: polling intervals read it without React plumbing.
let live = false;
const EMPTY: Viewer[] = []; // stable snapshot for useSyncExternalStore
export const isLive = () => live;
/** refetchInterval for queries: none while realtime is live, `ms` otherwise. */
export const pollUnlessLive = (ms: number) => () => (live ? false : ms);

interface Api {
  status: RealtimeStatus;
  subscribeIssue(issueId: string): () => void;
  setPresence(issueId: string, state: "viewing" | "typing" | "left"): void;
  presence(issueId: string): Viewer[];
  onChange(listener: () => void): () => void;
}
const noop: Api = { status: "offline", subscribeIssue: () => () => undefined, setPresence: () => undefined, presence: () => [], onChange: () => () => undefined };
const RealtimeContext = createContext<Api>(noop);
export const useRealtime = () => useContext(RealtimeContext);

export function RealtimeProvider({ workspaceId, children }: { workspaceId: string | null; children: ReactNode }) {
  const qc = useQueryClient();
  const state = useRef({ status: "connecting" as RealtimeStatus, presence: new Map<string, Viewer[]>(), issues: new Map<string, number>(), confirmed: new Set<string>(), wanted: new Map<string, "viewing" | "typing">(), listeners: new Set<() => void>() });
  const sockRef = useRef<WebSocket | null>(null);
  const notify = () => { for (const l of state.current.listeners) l(); };

  useEffect(() => {
    if (!workspaceId || typeof WebSocket === "undefined") return;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let flush: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (flush) return;
      flush = setTimeout(() => {
        flush = null;
        void qc.invalidateQueries({ queryKey: ["issues", workspaceId] });
        void qc.invalidateQueries({ queryKey: ["search", workspaceId] });
      }, 120);
    };
    const setStatus = (s: RealtimeStatus) => { state.current.status = s; live = s === "live"; notify(); };

    const connect = () => {
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${location.host}/v1/realtime`);
      sockRef.current = sock;
      sock.onmessage = (ev) => {
        let m: { op?: string; issue_id?: string; viewers?: Viewer[]; topic?: string };
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.op === "ready") {
          state.current.confirmed.clear();
          sock.send(JSON.stringify({ op: "sub", topic: `workspace:${workspaceId}:inbox` }));
          for (const id of state.current.issues.keys()) sock.send(JSON.stringify({ op: "sub", topic: `issue:${id}` }));
        } else if (m.op === "subscribed" && m.topic?.startsWith("issue:")) {
          // Presence is only accepted once the issue subscription is confirmed (server authorises it first).
          const id = m.topic.slice("issue:".length);
          state.current.confirmed.add(id);
          const want = state.current.wanted.get(id);
          if (want) sock.send(JSON.stringify({ op: "presence", issue_id: id, state: want }));
        } else if (m.op === "subscribed" && m.topic === `workspace:${workspaceId}:inbox`) {
          const reconnected = attempt > 0;
          attempt = 0;
          setStatus("live");
          if (reconnected) invalidate(); // catch up on anything missed while offline
        } else if (m.op === "event") invalidate();
        else if (m.op === "presence" && m.issue_id) { state.current.presence.set(m.issue_id, m.viewers ?? []); notify(); }
      };
      sock.onclose = () => {
        if (ping) clearInterval(ping);
        if (stopped) return;
        setStatus("offline");
        const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
        retry = setTimeout(connect, delay);
      };
      sock.onopen = () => { ping = setInterval(() => sock.readyState === 1 && sock.send('{"op":"ping"}'), 25_000); };
    };
    connect();
    return () => {
      stopped = true;
      live = false;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      if (flush) clearTimeout(flush);
      sockRef.current?.close();
      sockRef.current = null;
    };
  }, [workspaceId, qc]);

  const api = useMemo<Api>(() => ({
    get status() { return state.current.status; },
    subscribeIssue(issueId) {
      const n = state.current.issues.get(issueId) ?? 0;
      state.current.issues.set(issueId, n + 1);
      const sock = sockRef.current;
      if (n === 0 && sock?.readyState === 1) sock.send(JSON.stringify({ op: "sub", topic: `issue:${issueId}` }));
      return () => {
        const left = (state.current.issues.get(issueId) ?? 1) - 1;
        if (left > 0) { state.current.issues.set(issueId, left); return; }
        state.current.issues.delete(issueId);
        state.current.presence.delete(issueId);
        state.current.confirmed.delete(issueId);
        state.current.wanted.delete(issueId);
        if (sockRef.current?.readyState === 1) sockRef.current.send(JSON.stringify({ op: "unsub", topic: `issue:${issueId}` }));
      };
    },
    setPresence(issueId, s) {
      if (s === "left") state.current.wanted.delete(issueId); else state.current.wanted.set(issueId, s);
      if (state.current.confirmed.has(issueId) && sockRef.current?.readyState === 1) sockRef.current.send(JSON.stringify({ op: "presence", issue_id: issueId, state: s }));
    },
    presence: (issueId) => state.current.presence.get(issueId) ?? EMPTY,
    onChange(listener) { state.current.listeners.add(listener); return () => state.current.listeners.delete(listener); },
  }), []);
  return createElement(RealtimeContext.Provider, { value: api }, children);
}

/** Connection status, re-rendering on change. */
export function useRealtimeStatus(): RealtimeStatus {
  const rt = useRealtime();
  return useSyncExternalStore(rt.onChange, () => rt.status, () => "offline");
}

/**
 * Joins an issue's topic and presence while mounted: "viewing" now, "typing" via the returned function (falls back to
 * "viewing" after 4 s without keystrokes), "left" on unmount. Returns the other people on the issue.
 */
export function useIssuePresence(issueId: string | null, selfUserId: string | undefined) {
  const rt = useRealtime();
  const viewers = useSyncExternalStore(rt.onChange, () => (issueId ? rt.presence(issueId) : EMPTY), () => EMPTY);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typing = useRef(false);
  useEffect(() => {
    if (!issueId) return;
    rt.setPresence(issueId, "viewing"); // sent once the subscription is confirmed, and again after any reconnect
    const unsub = rt.subscribeIssue(issueId);
    return () => { if (idle.current) clearTimeout(idle.current); typing.current = false; rt.setPresence(issueId, "left"); unsub(); };
  }, [issueId, rt]);
  const others = useMemo(() => viewers.filter((v) => v.user_id !== selfUserId), [viewers, selfUserId]);
  const onTyping = () => {
    if (!issueId) return;
    if (!typing.current) { typing.current = true; rt.setPresence(issueId, "typing"); }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => { typing.current = false; rt.setPresence(issueId, "viewing"); }, 4000);
  };
  return { others, onTyping };
}
