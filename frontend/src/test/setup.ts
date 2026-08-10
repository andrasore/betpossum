import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; BetsTable's deep-link effect calls it.
Element.prototype.scrollIntoView = () => {};

// Nor ResizeObserver, which Radix's ScrollArea (inside Table.Root) constructs
// on mount. Observing nothing is fine — no test asserts on resize behaviour.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does implement localStorage, but Node's experimental webstorage global
// shadows it under vitest and what's left over is unusable in a
// version-dependent way: `undefined` on node 26, a method-less object on node
// 25 (what CI runs). Anything that persists a preference (useDashboardFilters,
// lib/auth) needs a real one, so probe for a working Storage — not for
// `undefined` — and back it with an in-memory implementation.
if (typeof globalThis.localStorage?.getItem !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage });
}
