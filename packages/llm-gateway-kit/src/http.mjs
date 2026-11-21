const SAFE_ERRORS = new Set([
  'auth_or_config', 'rate_limited', 'deadline_exceeded',
  'provider_unavailable', 'invalid_json', 'invalid_output', 'unknown_task',
]);
const RESPONSE_CAP = 65_536;
const MAX_REQUEST_CAP = 1_048_576;
const MAX_TEXT_CAP = 100_000;
const MAX_DEADLINE_CAP = 120_000;

export function createStructuredTaskBff({
  path, taskId, runner, enabled = false, allowedOrigins,
  maxRequestBytes = 8_192, maxTextLength = 2_000, deadlineMs = 4_000,
  maxCostUnits, verifyCaller, consumeRateLimit, reserveBudget, settleBudget,
} = {}) {
  if (typeof path !== 'string' || !path || !path.startsWith('/')) throw new TypeError('path is required');
  if (typeof taskId !== 'string' || !taskId.trim()) throw new TypeError('taskId is required');
  if (!runner || typeof runner.run !== 'function') throw new TypeError('runner.run is required');
  const origins = Array.isArray(allowedOrigins) ? [...allowedOrigins] : [];
  const originsValid = origins.length > 0 && origins.every(isAllowedOriginConfig);
  const limitsValid = positiveInt(maxRequestBytes) && maxRequestBytes <= MAX_REQUEST_CAP && positiveInt(maxTextLength) && maxTextLength <= MAX_TEXT_CAP && positiveInt(deadlineMs) && deadlineMs <= MAX_DEADLINE_CAP;
  const gateReady = enabled === true && limitsValid && positiveInteger(maxCostUnits) && originsValid &&
    typeof verifyCaller === 'function' && typeof consumeRateLimit === 'function' &&
    typeof reserveBudget === 'function' && typeof settleBudget === 'function';
  let latchedClosed = false;

  return async function handle(request) {
    const startedAt = performance.now();
    const remaining = () => Math.max(0, deadlineMs - (performance.now() - startedAt));
    const noStore = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
    if (!request || new URL(request.url).pathname !== path) return errorResponse(404, 'not_found', noStore, {});
    const origin = request?.headers?.get?.('Origin');
    const corsOrigin = typeof origin === 'string' && origins.includes(origin) ? origin : null;
    const cors = corsOrigin ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' } : {};
    if (!corsOrigin) return errorResponse(403, 'invalid_request', noStore, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...noStore, ...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization',
    }});
    if (request.method !== 'POST') return errorResponse(405, 'method_not_allowed', noStore, cors);
    if (!/^application\/json\s*(;\s*charset\s*=\s*[^;\s]+\s*)?$/i.test(request.headers.get('content-type') ?? '')) return errorResponse(415, 'invalid_request', noStore, cors);
    if (!gateReady || latchedClosed) return errorResponse(503, 'disabled', noStore, cors);

    const requestId = randomRequestId();
    if (!requestId) return errorResponse(503, 'provider_unavailable', noStore, cors);
    const verified = await callWithDeadline(() => verifyCaller(request), remaining());
    if (verified.timeout) return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    const identity = verified.error ? undefined : verified.value;
    if (verified.error) return errorResponse(503, 'provider_unavailable', noStore, cors, requestId);
    if (!identity || typeof identity !== 'object' || typeof identity.subjectKey !== 'string' || !identity.subjectKey.trim())
      return errorResponse(401, 'auth_or_config', noStore, cors, requestId);

    let body;
    const bodyController = new AbortController();
    const read = await callWithDeadline(() => readLimitedBody(request, maxRequestBytes, bodyController.signal), remaining(), () => bodyController.abort());
    if (read.timeout) return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    if (read.error) return errorResponse(400, 'invalid_request', noStore, cors, requestId);
    try { body = JSON.parse(read.value); } catch { return errorResponse(400, 'invalid_request', noStore, cors, requestId); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'text' && k !== 'consent') ||
      typeof body.text !== 'string' || body.text.trim().length === 0 || body.text.length > maxTextLength || body.consent !== true)
      return errorResponse(400, 'invalid_request', noStore, cors);
    const limited = await callWithDeadline(() => consumeRateLimit({ subjectKey: identity.subjectKey, taskId }), remaining());
    if (limited.timeout) return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    if (limited.error) return errorResponse(503, 'provider_unavailable', noStore, cors, requestId);
    if (limited.value !== true) return errorResponse(429, 'rate_limited', noStore, cors, requestId);
    if (latchedClosed || remaining() <= 0) return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    let reservation;
    const reservePromise = Promise.resolve().then(() => reserveBudget({ subjectKey: identity.subjectKey, taskId, requestId, maxCostUnits }));
    reservePromise.catch(() => undefined);
    const reserved = await callWithDeadline(() => reservePromise, remaining());
    if (reserved.timeout) {
      latchedClosed = true;
      reservePromise.then((late) => {
        if (late && typeof late === 'object' && typeof late.reservationId === 'string' && late.reservationId.trim())
          Promise.resolve().then(() => settleBudget({ subjectKey: identity.subjectKey, taskId, reservationId: late.reservationId, outcome: 'unknown' })).catch(() => undefined);
      }).catch(() => undefined);
      return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    }
    if (reserved.error) return errorResponse(503, 'provider_unavailable', noStore, cors, requestId);
    reservation = reserved.value;
    if (!reservation || typeof reservation !== 'object' || typeof reservation.reservationId !== 'string' || !reservation.reservationId.trim())
      return errorResponse(503, 'provider_unavailable', noStore, cors, requestId);
    if (latchedClosed || remaining() <= 0) {
      latchedClosed = true;
      await settleWithDeadline(() => settleBudget({ subjectKey: identity.subjectKey, taskId, reservationId: reservation.reservationId, outcome: 'unknown' }), deadlineMs);
      return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    }

    const controller = new AbortController();
    let timer;
    let outcome;
    try {
      const run = Promise.resolve().then(() => {
        if (latchedClosed || remaining() <= 0) return { timeout: true };
        return runner.run({ taskId, text: body.text, signal: controller.signal });
      });
      run.catch(() => undefined);
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), remaining()); });
      outcome = await Promise.race([run, timeout]);
    } catch { outcome = { ok: false, code: 'provider_unavailable' }; }
    finally { if (timer) clearTimeout(timer); }
    if (outcome?.timeout) {
      controller.abort(); latchedClosed = true;
      await settleWithDeadline(() => settleBudget({ subjectKey: identity.subjectKey, taskId, reservationId: reservation.reservationId, outcome: 'unknown' }), deadlineMs);
      return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    }
    if (latchedClosed || remaining() <= 0) {
      controller.abort(); latchedClosed = true;
      await settleWithDeadline(() => settleBudget({ subjectKey: identity.subjectKey, taskId, reservationId: reservation.reservationId, outcome: 'unknown' }), deadlineMs);
      return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    }
    const safeOutcome = outcome?.ok === true ? 'success' : 'unknown';
    const settled = await callWithDeadline(() => settleBudget({ subjectKey: identity.subjectKey, taskId, reservationId: reservation.reservationId, outcome: safeOutcome }), remaining());
    if (settled.timeout || settled.error || settled.value !== true) { latchedClosed = true; return errorResponse(503, settled.timeout ? 'deadline_exceeded' : 'provider_unavailable', noStore, cors, requestId); }
    if (remaining() <= 0) return errorResponse(504, 'deadline_exceeded', noStore, cors, requestId);
    if (outcome?.ok === true) {
      const response = { ok: true, requestId, value: outcome.value, taskVersion: outcome.taskVersion };
      const serialized = serializeUnderCap(response);
      if (!serialized) return errorResponse(502, 'provider_unavailable', noStore, cors, requestId);
      return responseFromSerialized(200, serialized, noStore, cors);
    }
    return errorResponse(502, SAFE_ERRORS.has(outcome?.code) ? outcome.code : 'provider_unavailable', noStore, cors, requestId);
  };
}

function positiveInt(value) { return Number.isSafeInteger(value) && value > 0; }
function positiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function isAllowedOriginConfig(value) {
  if (typeof value !== 'string' || !value || value === 'null') return false;
  try {
    const parsed = new URL(value);
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    return (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) &&
      parsed.origin === value && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch { return false; }
}
function randomRequestId() { try { return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : null; } catch { return null; } }
function jsonResponse(status, body, base, cors) { const serialized = JSON.stringify(body); return responseFromSerialized(status, serialized, base, cors); }
function responseFromSerialized(status, serialized, base, cors) { return new Response(serialized, { status, headers: { ...base, ...cors } }); }
function errorResponse(status, code, base, cors, requestId) { return jsonResponse(status, { ok: false, error: code, ...(requestId ? { requestId } : {}) }, base, cors); }
function serializeUnderCap(value) { try { const serialized = JSON.stringify(value); return new TextEncoder().encode(serialized).byteLength <= RESPONSE_CAP ? serialized : null; } catch { return null; } }
async function settleWithDeadline(fn, timeoutMs) {
  await callWithDeadline(fn, Math.min(timeoutMs, 1_000));
}
async function callWithDeadline(fn, timeoutMs, onTimeout) {
  if (timeoutMs <= 0) return { timeout: true };
  const operation = Promise.resolve().then(fn);
  operation.catch(() => undefined);
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { try { onTimeout?.(); } catch { /* best effort */ } resolve({ timeout: true }); }, timeoutMs); });
  try { return await Promise.race([operation.then((value) => ({ value }), (error) => ({ error })), timeout]); }
  catch (error) { return { error }; }
  finally { if (timer) clearTimeout(timer); }
}
async function readLimitedBody(request, maxBytes, signal) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('too_large');
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  const cancel = () => { reader.cancel('deadline_exceeded').catch(() => undefined); };
  if (signal?.aborted) { cancel(); throw new Error('deadline_exceeded'); }
  signal?.addEventListener('abort', cancel, { once: true });
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { reader.cancel('too_large').catch(() => undefined); throw new Error('too_large'); } chunks.push(value); } }
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
