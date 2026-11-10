import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyAccess } from '../src/worker/access.ts';

const team = 'https://example.cloudflareaccess.com';
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function keyPair(kid: string) {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', k.publicKey)), kid };
  return { priv: k.privateKey, jwk };
}
async function token(priv: CryptoKey, kid: string, claims: object) {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, new TextEncoder().encode(head));
  return head + '.' + Buffer.from(sig).toString('base64url');
}

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Access token', () => {
  it('accepts a valid token and rejects forged, expired or foreign ones', async () => {
    const good = await keyPair('k1');
    const evil = await keyPair('k1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [good.jwk] }))));
    const cfg = { team, aud: ['app-aud'] };
    const now = Math.floor(Date.now() / 1000);
    const claims = { email: 'a@b.c', iss: team, aud: ['app-aud'], exp: now + 600 };

    expect(await verifyAccess(await token(good.priv, 'k1', claims), cfg)).toBe('a@b.c');
    expect(await verifyAccess(await token(evil.priv, 'k1', claims), cfg)).toBeNull(); // wrong signature
    expect(await verifyAccess(await token(good.priv, 'k1', { ...claims, exp: now - 3600 }), cfg)).toBeNull();
    expect(await verifyAccess(await token(good.priv, 'k1', { ...claims, aud: ['other-app'] }), cfg)).toBeNull();
    expect(await verifyAccess(await token(good.priv, 'k1', { ...claims, iss: 'https://evil.cloudflareaccess.com' }), cfg)).toBeNull();
    expect(await verifyAccess(await token(good.priv, 'k9', claims), cfg)).toBeNull(); // unknown key
    expect(await verifyAccess('not.a.jwt', cfg)).toBeNull();
    expect(await verifyAccess(undefined, cfg)).toBeNull();
  });
});
