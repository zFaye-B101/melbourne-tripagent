import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuredTaskBff } from '../src/http.mjs';

const origin = 'https://app.example';
const input = JSON.stringify({ text: 'hello', consent: true });
function makeRunner(result = { ok: true, value: { answer: 'ok' }, taskVersion: '1' }) {
  const calls = [];
  return { calls, run: async (value) => { calls.push(value); return result; } };
}
function hooks(overrides = {}) {
  return {
    verifyCaller: async () => ({ subjectKey: 'user-1' }),
    consumeRateLimit: async () => true,
    reserveBudget: async () => ({ reservationId: 'r-1' }),
    settleBudget: async () => true,
    ...overrides,
  };
}
function make(options = {}, runner = makeRunner()) {
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, ...hooks(), ...options });
  return { handler, runner };
}
function request(body = input, options = {}) {
  return new Request('https://bff.example/v1/task', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json', ...options.headers }, body });
}

test('default-off and incomplete gates never call runner', async () => {
  const runner = makeRunner();
  const disabled = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin] });
  assert.equal((await disabled(request())).status, 503);
  const incomplete = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1 });
  assert.equal((await incomplete(request())).status, 503);
  assert.equal(runner.calls.length, 0);
});

test('origin, consent, fields, content type and size are strict', async () => {
  const { handler, runner } = make();
  assert.equal((await handler(new Request('https://bff.example/v1/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: input }))).status, 403);
  assert.equal((await handler(request(JSON.stringify({ text: 'x', consent: false })))).status, 400);
  assert.equal((await handler(request(JSON.stringify({ text: 'x', consent: true, extra: 1 })))).status, 400);
  assert.equal((await handler(request(input, { headers: { 'content-type': 'text/plain' } }))).status, 415);
  const small = make({ maxRequestBytes: 4 });
  assert.equal((await small.handler(request())).status, 400);
  assert.equal(runner.calls.length, 0);
});

test('unauthenticated, rate and budget failures happen before runner', async () => {
  for (const override of [{ verifyCaller: async () => null }, { consumeRateLimit: async () => false }, { reserveBudget: async () => ({}) }]) {
    const { handler, runner } = make(override);
    assert.notEqual((await handler(request())).status, 200);
    assert.equal(runner.calls.length, 0);
  }
});

test('successful run settles and returns only safe structured output', async () => {
  const runner = makeRunner(); let settled; let reserved;
  const { handler } = make({ reserveBudget: async (value) => { reserved = value; return { reservationId: 'r-1' }; }, settleBudget: async (value) => { settled = value; return true; } }, runner);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, requestId: reserved.requestId, value: { answer: 'ok' }, taskVersion: '1' });
  assert.equal(settled.outcome, 'success');
  assert.equal(runner.calls[0].taskId, 'task');
});

test('concurrent calls delegate budget race to reserve hook', async () => {
  let reservations = 0;
  const { handler, runner } = make({ reserveBudget: async () => (++reservations === 1 ? { reservationId: 'r' } : {}) });
  const results = await Promise.all([handler(request()), handler(request())]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(runner.calls.length, 1);
});

test('timeout and settlement failure latch handler closed and preserve reservation', async () => {
  const pendingRunner = { calls: [], run: ({ signal }) => new Promise((resolve) => { pendingRunner.calls.push(signal); }) };
  const timeout = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner: pendingRunner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 5, ...hooks() });
  assert.equal((await timeout(request())).status, 504);
  assert.equal(pendingRunner.calls[0].aborted, true);
  assert.equal((await timeout(request())).status, 503);
  const runner = makeRunner();
  const settleFail = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, ...hooks({ settleBudget: async () => { throw new Error('x'); } }) });
  assert.equal((await settleFail(request())).status, 503);
  assert.equal((await settleFail(request())).status, 503);
  assert.equal(runner.calls.length, 1);
});

test('runner errors settle as unknown and provider details are not echoed', async () => {
  let settled;
  const runner = makeRunner({ ok: false, code: 'PRIVATE_PROVIDER_BODY' });
  const { handler } = make({ settleBudget: async (v) => { settled = v; return true; } }, runner);
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.equal(settled.outcome, 'unknown');
  assert.equal((await response.text()).includes('PRIVATE'), false);
});

test('fails closed for unsafe origin config, fractional cost, and unavailable UUID', async () => {
  const runner = makeRunner();
  for (const allowedOrigins of [['null'], ['http://evil.example'], ['https://app.example/path']]) {
    const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins, enabled: true, maxCostUnits: 1, ...hooks() });
    assert.notEqual((await handler(request())).status, 200);
  }
  const fractional = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1.5, ...hooks() });
  assert.equal((await fractional(request())).status, 503);
  const previous = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    const unavailable = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, ...hooks() });
    assert.equal((await unavailable(request())).status, 503);
    assert.equal(runner.calls.length, 0);
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previous }); }
});

test('verifier exceptions are service errors and timeout attempts unknown settlement', async () => {
  const runner = makeRunner();
  const authError = make({ verifyCaller: async () => { throw new Error('private'); } }, runner);
  assert.equal((await authError.handler(request())).status, 503);
  let settled;
  const hanging = { run: async () => new Promise(() => {}) };
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner: hanging, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 5, ...hooks({ settleBudget: async (v) => { settled = v; return true; } }) });
  assert.equal((await handler(request())).status, 504);
  assert.equal(settled.outcome, 'unknown');
});

test('response cap uses one serialization for stateful toJSON values', async () => {
  let count = 0;
  const runner = makeRunner({ ok: true, value: { toJSON: () => (++count === 1 ? 'small' : 'x'.repeat(70_000)) }, taskVersion: '1' });
  const { handler } = make({}, runner);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('small'), true);
  assert.equal(count, 1);
});

test('copies the origin policy and rejects unsafe integer cost', async () => {
  const policy = [origin]; const runner = makeRunner();
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: policy, enabled: true, maxCostUnits: 1, ...hooks() });
  policy[0] = 'https://changed.example';
  assert.equal((await handler(request())).status, 200);
  const unsafe = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: Number.MAX_SAFE_INTEGER + 1, ...hooks() });
  assert.equal((await unsafe(request())).status, 503);
});

test('rechecks deadline after a synchronous reserve overrun before runner', async () => {
  const runner = makeRunner();
  let reserves = 0;
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 30, ...hooks({ reserveBudget: async () => { reserves++; const end = performance.now() + 50; while (performance.now() < end) {} return { reservationId: 'late' }; } }) });
  assert.equal((await handler(request())).status, 504);
  assert.equal(reserves, 1);
  assert.equal(runner.calls.length, 0);
});

test('does not start reserve after a synchronous rate-limit overrun', async () => {
  const runner = makeRunner(); let limits = 0; let reserves = 0;
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 30, ...hooks({ consumeRateLimit: async () => { limits++; const end = performance.now() + 50; while (performance.now() < end) {} return true; }, reserveBudget: async () => { reserves++; return { reservationId: 'never' }; } }) });
  assert.equal((await handler(request())).status, 504);
  assert.equal(limits, 1); assert.equal(reserves, 0); assert.equal(runner.calls.length, 0);
});

test('does not report success when settlement overruns the deadline', async () => {
  const runner = makeRunner(); let settles = 0;
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 30, ...hooks({ settleBudget: async () => { settles++; const end = performance.now() + 50; while (performance.now() < end) {} return true; } }) });
  assert.equal((await handler(request())).status, 504);
  assert.equal(settles, 1); assert.equal(runner.calls.length, 1);
});

test('concurrent request that reserved before latch cannot call runner', async () => {
  let releaseA; let releaseB; let reservations = 0; let settles = 0;
  const runner = { calls: [], run: async (value) => { runner.calls.push(value); if (runner.calls.length === 1) return new Promise((resolve) => { releaseA = resolve; }); return { ok: true, value: {}, taskVersion: '1' }; } };
  const reserveB = new Promise((resolve) => { releaseB = resolve; });
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 1_000, ...hooks({ reserveBudget: async () => (++reservations === 1 ? { reservationId: 'a' } : reserveB), settleBudget: async () => (++settles === 1 ? false : true) }) });
  const first = handler(request());
  while (runner.calls.length < 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const second = handler(request());
  while (reservations < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  releaseA({ ok: true, value: {}, taskVersion: '1' });
  assert.equal((await first).status, 503);
  releaseB({ reservationId: 'b' });
  assert.notEqual((await second).status, 200);
  assert.equal(runner.calls.length, 1);
});

test('slow body timeout does not permanently latch handler', async () => {
  const runner = makeRunner();
  const handler = createStructuredTaskBff({ path: '/v1/task', taskId: 'task', runner, allowedOrigins: [origin], enabled: true, maxCostUnits: 1, deadlineMs: 2, ...hooks() });
  let cancelled = false;
  const slowBody = new ReadableStream({ start(controller) { setTimeout(() => { if (!cancelled) { controller.enqueue(new TextEncoder().encode(input)); controller.close(); } }, 20); }, cancel() { cancelled = true; } });
  const first = await handler(new Request('https://bff.example/v1/task', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: slowBody, duplex: 'half' }));
  assert.equal(first.status, 504);
  assert.equal((await handler(request())).status, 200);
  assert.equal(runner.calls.length, 1);
});
