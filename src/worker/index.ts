import { Hono } from 'hono';
import type { SyncRequest } from '../core/sync.ts';
import { MAX_CHANGES_PER_REQUEST, MAX_PHOTO_BYTES, validateChange } from '../core/sync.ts';
import { getBlob, putBlob, sha256Hex, sync } from './store.ts';

// Cloudflare Worker. Static files come from the ASSETS binding (dist/);
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  PHOTOS: D1Database;
  /** Local development only (.dev.vars): identity when there is no Cloudflare Access. */
  DEV_USER?: string;
};
type Vars = { user: string };

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

/**
 * Who is calling. With Access enabled on the Worker, Cloudflare authenticates
 * every request before it reaches this code and exposes the identity on
 * ctx.access. The header is set by Access for hostname-based applications.
 */
async function identify(c: { executionCtx: unknown; req: { header(n: string): string | undefined }; env: Env }) {
  try {
    const access = (c.executionCtx as unknown as { access?: { getIdentity(): Promise<{ email?: string } | undefined> } }).access;
    const email = (await access?.getIdentity())?.email;
    if (email) return { email, source: 'access' as const };
  } catch {
    /* Access not enabled on this Worker */
  }
  const header = c.req.header('Cf-Access-Authenticated-User-Email');
  if (header) return { email: header, source: 'header' as const };
  if (c.env.DEV_USER) return { email: c.env.DEV_USER, source: 'dev' as const };
  return null;
}

app.get('/health', c => c.json({ app: 'racknotes', ok: true }));

app.get('/me', async c => {
  const who = await identify(c);
  return c.json({ email: who?.email ?? null, source: who?.source ?? null });
});

// Everything below requires a known user.
app.use('*', async (c, next) => {
  const who = await identify(c);
  if (!who) return c.json({ error: 'Нужен е вход.' }, 401);
  c.set('user', who.email);
  await next();
});

app.post('/sync', async c => {
  let body: SyncRequest;
  try {
    body = await c.req.json<SyncRequest>();
  } catch {
    return c.json({ error: 'Невалидна заявка.' }, 400);
  }
  if (!Number.isInteger(body?.cursor) || body.cursor < 0 || !Array.isArray(body.changes))
    return c.json({ error: 'Невалидна заявка.' }, 400);
  if (body.changes.length > MAX_CHANGES_PER_REQUEST) return c.json({ error: 'Твърде много промени наведнъж.' }, 413);
  for (const ch of body.changes) {
    const err = validateChange(ch);
    if (err) return c.json({ error: err, id: (ch as { id?: unknown })?.id ?? null }, 400);
  }
  return c.json(await sync(c.env.DB, c.env.PHOTOS, c.get('user'), body.cursor, body.changes));
});

app.put('/blobs/:hash{[0-9a-f]{64}}', async c => {
  const hash = c.req.param('hash');
  const mime = c.req.header('Content-Type') ?? '';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return c.json({ error: 'Позволени са само снимки.' }, 415);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return c.json({ error: 'Снимката е твърде голяма.' }, 413);
  if ((await sha256Hex(bytes)) !== hash) return c.json({ error: 'Съдържанието не съвпада с отпечатъка.' }, 400);
  await putBlob(c.env.PHOTOS, hash, mime, bytes, c.get('user'));
  return c.body(null, 204);
});

app.get('/blobs/:hash{[0-9a-f]{64}}', async c => {
  const blob = await getBlob(c.env.PHOTOS, c.req.param('hash'));
  if (!blob) return c.json({ error: 'Няма такава снимка.' }, 404);
  return new Response(blob.bytes, {
    headers: {
      'Content-Type': blob.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
});

app.notFound(c => c.json({ error: 'Непознат API адрес.' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Грешка в сървъра.' }, 500);
});

export default app;
