import { Hono } from 'hono';

// Cloudflare Worker. Static files come from the ASSETS binding (dist/);
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
// Milestone 1: identity + health only. Sync (D1/R2) and the NetBox catalog
// via Cloudflare Tunnel are added in milestones 2–3 (docs/ROADMAP.md).

type Env = { ASSETS: Fetcher };

const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

app.get('/health', c => c.json({ app: 'racknotes', ok: true }));

// Who is signed in. With Access enabled on the Worker, the runtime exposes the
// identity on ctx.access; hostname-based Access sets a header instead.
// Display only for now — milestone 2 enforces identity before accepting data.
app.get('/me', async c => {
  let email: string | null = null;
  try {
    const access = (c.executionCtx as unknown as { access?: { getIdentity(): Promise<{ email?: string }> } }).access;
    email = (await access?.getIdentity())?.email ?? null;
  } catch {
    /* Access not enabled on this Worker */
  }
  email ??= c.req.header('Cf-Access-Authenticated-User-Email') ?? null;
  return c.json({ email });
});

app.notFound(c => c.json({ error: 'Непознат API адрес.' }, 404));

export default app;
