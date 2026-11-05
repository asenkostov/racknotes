// Small shared UI state: toast, online flag, surveyor name.

export const ui = $state({
  toast: '',
  online: navigator.onLine,
  author: localStorage.getItem('racknotes.author') ?? ''
});

let timer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  ui.toast = message;
  clearTimeout(timer);
  timer = setTimeout(() => (ui.toast = ''), 3500);
}

export function setAuthor(name: string) {
  ui.author = name.trim();
  localStorage.setItem('racknotes.author', ui.author);
}

addEventListener('online', () => (ui.online = true));
addEventListener('offline', () => (ui.online = false));

/** Behind Cloudflare Access the API knows who is signed in; use it as the default surveyor. */
export async function loadIdentity() {
  try {
    const r = await fetch('/api/me', { cache: 'no-store' });
    if (!r.ok) return;
    const me = (await r.json()) as { email?: string | null };
    if (me.email && !ui.author) setAuthor(me.email);
  } catch {
    /* offline or running without the Worker */
  }
}
