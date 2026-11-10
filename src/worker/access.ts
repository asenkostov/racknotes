// Verifies the Cloudflare Access token (Cf-Access-Jwt-Assertion) that Access
// adds to every request it lets through: RS256 signature against the team's
// public keys, issuer, audience (the Access application) and expiry.
// Without this, the identity would rest only on Access being in front of
// every route.

export interface AccessConfig {
  /** https://<team>.cloudflareaccess.com */
  team: string;
  /** Application audience tags (AUD); several when previews use their own application. */
  aud: string[];
}

interface Jwk extends JsonWebKey {
  kid: string;
}

let keys: { at: number; team: string; list: Jwk[] } | null = null;
const KEYS_TTL = 60 * 60 * 1000;

async function teamKeys(team: string, force = false): Promise<Jwk[]> {
  if (!force && keys && keys.team === team && Date.now() - keys.at < KEYS_TTL) return keys.list;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Access certs: ' + res.status);
  const body = (await res.json()) as { keys: Jwk[] };
  keys = { at: Date.now(), team, list: body.keys };
  return body.keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export interface AccessClaims {
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

/** Payload without any checks — only for showing which application signed a token. */
export function peek(token: string): AccessClaims | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64url(token.split('.')[1]))) as AccessClaims;
  } catch {
    return null;
  }
}

/** The verified email, or null if the token is missing, forged, expired or for another application. */
export async function verifyAccess(token: string | undefined, cfg: AccessConfig): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== cfg.team) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some(a => a && cfg.aud.includes(a))) return null;
  if (!claims.exp || claims.exp < now - 30 || (claims.nbf && claims.nbf > now + 30)) return null;

  // Keys rotate: refetch once if the kid is unknown.
  let jwk = (await teamKeys(cfg.team)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await teamKeys(cfg.team, true)).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok && claims.email ? claims.email : null;
}
