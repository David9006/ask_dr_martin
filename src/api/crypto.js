// PBKDF2-SHA256 through WebCrypto: available in both the Workers runtime and Node,
// and far cheaper than scrypt for Workers CPU budgets.
//
// Cloudflare's WebCrypto rejects iteration counts above 100000
// ("Pbkdf2 failed: iteration counts above 100000 are not supported"),
// so 100000 is the hard ceiling on Workers — do not raise it.
// The count is stored inside each hash, so existing hashes stay verifiable.

const ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function derive(password, salt, iterations, keyBytes) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    keyBytes * 8
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, ITERATIONS, KEY_BYTES);
  return ['pbkdf2', 'sha256', ITERATIONS, base64url(salt), base64url(key)].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, hash, iterations, salt, digest] = String(stored).split('$');
    if (scheme !== 'pbkdf2' || hash !== 'sha256') return false;
    const expected = fromBase64url(digest);
    const actual = await derive(password, fromBase64url(salt), Number(iterations), expected.length);
    return timingSafeEqual(actual, expected);
  } catch (err) {
    return false;
  }
}

export function randomToken() {
  return base64url(randomBytes(32));
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
