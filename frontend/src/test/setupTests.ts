import '@testing-library/jest-dom';

// jsdom (jest-environment-jsdom 29) does not expose structuredClone, but
// dagre relies on it. Polyfill from Node's global if available.
if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function') {
  (globalThis as { structuredClone: typeof structuredClone }).structuredClone = (value: unknown) =>
    JSON.parse(JSON.stringify(value));
}
