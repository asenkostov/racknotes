import { describe, expect, it } from 'vitest';
import app from '../src/worker/index.ts';

const me = async (env: Record<string, string>) => (await (await app.request('/api/me', {}, env)).json()) as { email: string | null; source: string | null };

describe('worker identity', () => {
  it('uses DEV_USER only when Access strict mode is off', async () => {
    expect(await me({ DEV_USER: 'dev@local' })).toMatchObject({ email: 'dev@local', source: 'dev' });
    // A stray DEV_USER in production must not bypass the signed Access token.
    expect(await me({ DEV_USER: 'dev@local', ACCESS_TEAM: 'https://t.cloudflareaccess.com', ACCESS_AUD: 'aud' })).toMatchObject({ email: null });
  });

  it('ignores the unsigned email header in strict mode', async () => {
    const env = { ACCESS_TEAM: 'https://t.cloudflareaccess.com', ACCESS_AUD: 'aud' };
    const res = await app.request('/api/sync', { method: 'POST', headers: { 'Cf-Access-Authenticated-User-Email': 'evil@x' }, body: '{}' }, env);
    expect(res.status).toBe(401);
  });
});

describe('photo blobs', () => {
  it('are never cached by the browser', async () => {
    const { fakeD1 } = await import('./helpers/fake-d1.js');
    const { putBlob, sha256Hex } = await import('../src/worker/store.ts');
    const PHOTOS = fakeD1();
    const bytes = new TextEncoder().encode('x').buffer as ArrayBuffer;
    const hash = await sha256Hex(bytes);
    await putBlob(PHOTOS, hash, 'image/jpeg', bytes, 'a@x');
    const res = await app.request('/api/blobs/' + hash, {}, { DEV_USER: 'a@x', PHOTOS });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
