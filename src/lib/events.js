// App-wide event bus. Domain events (e.g. "module.added") drive the guide engine's action validation.
const listeners = new Map();
const anyListeners = new Set();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  onAny(fn) {
    anyListeners.add(fn);
    return () => anyListeners.delete(fn);
  },
  emit(event, payload = {}) {
    listeners.get(event)?.forEach((fn) => safe(fn, payload, event));
    anyListeners.forEach((fn) => safe(fn, payload, event));
  },
};

function safe(fn, payload, event) {
  try {
    fn(payload, event);
  } catch (err) {
    console.error(`[bus] handler for "${event}" failed`, err);
  }
}
