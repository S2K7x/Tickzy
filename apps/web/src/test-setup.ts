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

// jsdom has no layout (every offset/client size is 0), so a virtualised list would render no rows. Give elements plausible
// sizes: 800px for containers, 96px for measured virtual rows (they carry data-index). Real layout is checked in browsers.
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) { return this.dataset.index !== undefined ? 96 : 800; },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 1024; } });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 800; } });
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1024; } });

// cmdk (command palette) measures its list and scrolls the active option into view; jsdom implements neither.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
Element.prototype.scrollIntoView = function scrollIntoView() {};
