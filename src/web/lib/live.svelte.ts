import { liveQuery } from 'dexie';

/**
 * Reactive Dexie query for Svelte 5. `deps` is read inside an effect, so the
 * query re-subscribes when any reactive value it touches changes; `query`
 * re-runs whenever the underlying IndexedDB tables change.
 */
export function live<D, T>(deps: () => D, query: (d: D) => Promise<T> | T) {
  let value = $state<T | undefined>(undefined);
  let loaded = $state(false);
  $effect(() => {
    const d = deps();
    const sub = liveQuery(() => query(d)).subscribe({
      next: v => {
        value = v;
        loaded = true;
      },
      error: e => console.error(e)
    });
    return () => sub.unsubscribe();
  });
  return {
    get value() {
      return value;
    },
    get loaded() {
      return loaded;
    }
  };
}
