import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; BetsTable's deep-link effect calls it.
Element.prototype.scrollIntoView = () => {};

// jsdom does implement localStorage, but Node's experimental webstorage global
// shadows it under vitest, leaving `localStorage` undefined. Anything that
// persists a preference (useDashboardFilters, lib/auth) needs a real one, so
// back it with an in-memory Storage.
if (globalThis.localStorage === undefined) {
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
