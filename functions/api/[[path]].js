import { handleApi } from '../../src/api/handler.js';

export function onRequest(context) {
  const ip = context.request.headers.get('cf-connecting-ip') || '';
  return handleApi(context.request, context.env, { ip });
}
