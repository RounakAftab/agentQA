// Signed session tokens built on Web Crypto, so the same code runs in route handlers
// and in proxy.js. Format: base64url(payload).base64url(HMAC-SHA256(payload)).

export const SESSION_COOKIE = 'agentqa_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

const encoder = new TextEncoder();

const toB64Url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64Url = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const importKey = (secret, usages) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

export async function signSession(userId, secret) {
  const payload = toB64Url(
    encoder.encode(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE }))
  );
  const sig = await crypto.subtle.sign('HMAC', await importKey(secret, ['sign']), encoder.encode(payload));
  return `${payload}.${toB64Url(sig)}`;
}

// Returns { uid } for a valid, unexpired token, otherwise null.
export async function verifySession(token, secret) {
  if (!token || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await importKey(secret, ['verify']),
      fromB64Url(sig),
      encoder.encode(payload)
    );
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64Url(payload)));
    if (!data.uid || data.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}
