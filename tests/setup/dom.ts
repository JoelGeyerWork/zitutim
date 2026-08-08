import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Base UI components measure and observe elements; jsdom ships neither API.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/**
 * Node 26 defines its own `localStorage` global that stays `undefined` unless
 * the process is started with --localstorage-file, and it shadows the one
 * jsdom installs. Substitute a working in-memory Storage so components that
 * read it behave as they do in a browser.
 */
function createStorage(): Storage {
  let entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: (key) => void entries.delete(key),
    clear: () => void (entries = new Map()),
  };
}

/**
 * jsdom has no media-query engine, and next-themes watches
 * `(prefers-color-scheme: dark)`. Rather than hardcoding "nothing matches" —
 * which would leave the `system` → dark path, the one most first-time visitors
 * take, permanently untestable — keep a set of queries that currently match and
 * let a test flip them with `setMatchingMedia()`.
 */
type MediaListener = (event: MediaQueryListEvent) => void;

const matching = new Set<string>();
const mediaListeners = new Map<string, Set<MediaListener>>();

function matchMediaStub(query: string): MediaQueryList {
  const listeners =
    mediaListeners.get(query) ??
    mediaListeners.set(query, new Set()).get(query)!;

  // Cast at the end: the real MediaQueryList types addEventListener as an
  // overload over every event name, which a plain object literal can't satisfy.
  return {
    get matches() {
      return matching.has(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: MediaListener) =>
      void listeners.add(listener),
    removeEventListener: (_type: string, listener: MediaListener) =>
      void listeners.delete(listener),
    // The deprecated pair, which next-themes still falls back to.
    addListener: (listener: MediaListener) => void listeners.add(listener),
    removeListener: (listener: MediaListener) => void listeners.delete(listener),
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

/**
 * Make `queries` the ones that match, and notify anything already listening —
 * so a test can simulate the OS switching scheme mid-session, not just start
 * out in one. Reset before every test.
 */
export function setMatchingMedia(...queries: string[]) {
  matching.clear();
  for (const query of queries) matching.add(query);

  for (const [query, listeners] of mediaListeners) {
    const event = {
      matches: matching.has(query),
      media: query,
    } as MediaQueryListEvent;
    for (const listener of listeners) listener(event);
  }
}

/** The query next-themes watches; spelled out here so tests needn't repeat it. */
export const PREFERS_DARK = "(prefers-color-scheme: dark)";

vi.stubGlobal("matchMedia", matchMediaStub);
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
vi.stubGlobal("localStorage", createStorage());

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  localStorage.clear();
  // Default to "no media query matches", so a test that flips one can't leak
  // into the next.
  setMatchingMedia();
  mediaListeners.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks leaves vi.fn()s from vi.mock factories alone, so their call
  // history would otherwise carry over between tests.
  vi.clearAllMocks();
});
