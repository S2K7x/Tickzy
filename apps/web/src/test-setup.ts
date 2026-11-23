// jsdom lacks matchMedia; default to light so tests are deterministic.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
window.scrollTo = () => undefined;

// jsdom's WebSocket would try a real network connection: tests get an inert fake (realtime tests install their own).
class InertWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() { this.readyState = 3; }
}
(globalThis as { WebSocket: unknown }).WebSocket = InertWebSocket;
