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
 * jsdom has no media-query engine. next-themes watches
 * `(prefers-color-scheme: dark)`, so report "no match" rather than throwing.
 */
function matchMediaStub(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

vi.stubGlobal("matchMedia", matchMediaStub);
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
vi.stubGlobal("localStorage", createStorage());

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // restoreAllMocks leaves vi.fn()s from vi.mock factories alone, so their call
  // history would otherwise carry over between tests.
  vi.clearAllMocks();
});
