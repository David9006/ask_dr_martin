const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '600'
};

export function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS }
  });
}

export function fail(status, code, message) {
  return json(status, { error: { code, message } });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function readJson(request, limit = 64 * 1024) {
  const text = await request.text();
  if (text.length > limit) throw httpError(413, 'payload_too_large', 'Payload too large.');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    throw httpError(400, 'invalid_json', 'Body must be valid JSON.');
  }
}

export function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}
