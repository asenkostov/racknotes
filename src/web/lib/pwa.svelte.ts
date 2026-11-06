import { registerSW } from 'virtual:pwa-register';

// New versions are downloaded in the background; the user decides when to switch.

export const pwa = $state({ needRefresh: false, updating: false });

let update: ((reload?: boolean) => Promise<void>) | undefined;

export function startPwa() {
  if (!('serviceWorker' in navigator)) return;
  update = registerSW({
    onNeedRefresh() {
      pwa.needRefresh = true;
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) reg.update().catch(() => {});
      };
      // Phones keep a PWA open for days: look for a new version regularly and on return.
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    }
  });
}

/** Activate the waiting version and reload. Local data and the sync queue live in IndexedDB and survive. */
export async function applyUpdate() {
  pwa.updating = true;
  await update?.(true);
}
