import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; BetsTable's deep-link effect calls it.
Element.prototype.scrollIntoView = () => {};
