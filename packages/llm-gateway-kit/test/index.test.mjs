import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashscopeCompatibleProvider, createOpenAIResponsesProvider, createStructuredTaskRunner } from '../src/index.mjs';

const schema = { type: 'object', properties: { category: { type: 'string' }, priority: { type: 'string' } }, required: ['category', 'priority'], additionalProperties: false };
const task = { id: 'support-classify', version: '1', systemPrompt: 'Classify synthetic customer support messages.', schemaName: 'support_classification', jsonSchema: schema, validateOutput: (v) => v && typeof v.category === 'string' && typeof v.priority === 'string' };

test('provider sends Responses request shape and extracts output_text', async () => {
  let seen;
  const provider = createOpenAIResponsesProvider({ apiKey: 'test-secret', model: 'test-model', maxOutputTokens: 321, fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ status: 'completed', output_text: '{"category":"billing","priority":"high"}' }), { status: 200 }); } });
  const result = await provider.generate({ systemPrompt: task.systemPrompt, userText: 'My invoice is wrong.', schemaName: task.schemaName, jsonSchema: schema });
  assert.deepEqual(result, { ok: true, outputText: '{"category":"billing","priority":"high"}' });
  assert.equal(seen.url, 'https://api.openai.com/v1/responses');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.authorization, 'Bearer test-secret');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.store, false); assert.equal(body.model, 'test-model'); assert.equal(body.max_output_tokens, 321);
  assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true); assert.equal(body.text.format.name, task.schemaName);
  assert.equal(body.input[0].content[0].text, task.systemPrompt); assert.equal(body.input[1].content[0].text, 'My invoice is wrong.');
  assert.equal(body.input[0].content[0].text.includes('travel'), false);
});

test('structured runner stays disabled without calling provider', async () => {
  let calls = 0;
  const runner = createStructuredTaskRunner({ tasks: [task], provider: { generate: async () => { calls++; return { ok: true, outputText: '{}' }; } } });
  assert.deepEqual(await runner.run({ taskId: task.id, text: 'Help' }), { ok: false, code: 'disabled' });
  assert.equal(calls, 0);
});

test('runner parses, normalizes, validates and returns task version', async () => {
  const runner = createStructuredTaskRunner({ enabled: true, tasks: [{ ...task, normalizeOutput: (v) => ({ ...v, category: v.category.trim() }) }], provider: { generate: async () => ({ ok: true, outputText: '{"category":" billing ","priority":"high"}' }) } });
  assert.deepEqual(await runner.run({ taskId: task.id, text: 'Invoice issue' }), { ok: true, value: { category: 'billing', priority: 'high' }, taskVersion: '1' });
});

test('runner rejects unknown and empty input, invalid JSON and schema', async () => {
  const provider = { generate: async () => ({ ok: true, outputText: 'not json' }) };
  const runner = createStructuredTaskRunner({ enabled: true, tasks: [task], provider });
  assert.deepEqual(await runner.run({ taskId: 'nope', text: 'x' }), { ok: false, code: 'unknown_task' });
  assert.deepEqual(await runner.run({ taskId: task.id, text: '   ' }), { ok: false, code: 'empty_text' });
  assert.deepEqual(await runner.run({ taskId: task.id, text: 'x' }), { ok: false, code: 'invalid_json' });
  const bad = createStructuredTaskRunner({ enabled: true, tasks: [{ ...task, validateOutput: () => false }], provider: { generate: async () => ({ ok: true, outputText: '{}' }) } });
  assert.deepEqual(await bad.run({ taskId: task.id, text: 'x' }), { ok: false, code: 'invalid_output' });
});

test('provider maps statuses, abort, and never returns provider body', async () => {
  const missingConfig = createOpenAIResponsesProvider({ fetchImpl: async () => { throw new Error('must not call'); } });
  assert.deepEqual(await missingConfig.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema }), { ok: false, code: 'auth_or_config' });
  for (const [status, code] of [[401, 'auth_or_config'], [403, 'auth_or_config'], [429, 'rate_limited'], [500, 'provider_unavailable']]) {
    const provider = createOpenAIResponsesProvider({ apiKey: 'secret', model: 'm', fetchImpl: async () => new Response('PRIVATE_PROVIDER_BODY', { status }) });
    const result = await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema });
    assert.deepEqual(result, { ok: false, code }); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
  const ac = new AbortController(); ac.abort();
  const provider = createOpenAIResponsesProvider({ apiKey: 'secret', model: 'm', fetchImpl: async () => { throw new Error('abort'); } });
  assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema, signal: ac.signal }), { ok: false, code: 'deadline_exceeded' });
  const empty = createOpenAIResponsesProvider({ apiKey: 'secret', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [] }), { status: 200 }) });
  assert.deepEqual(await empty.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema }), { ok: false, code: 'invalid_json' });
});

test('provider validates maxOutputTokens before fetch', () => {
  for (const maxOutputTokens of [0, -1, NaN, Infinity, 9000]) {
    assert.throws(() => createOpenAIResponsesProvider({ apiKey: 'x', model: 'm', maxOutputTokens, fetchImpl: async () => { throw new Error('must not call'); } }), TypeError);
  }
  assert.doesNotThrow(() => createOpenAIResponsesProvider({ apiKey: 'x', model: 'm', maxOutputTokens: 8192, fetchImpl: async () => new Response('{}') }));
});

test('provider rejects incomplete/error/reasoning output and only accepts assistant messages', async () => {
  for (const [payload, code] of [
    [{ status: 'in_progress', output_text: '{"category":"bad"}' }, 'provider_unavailable'],
    [{ status: 'failed', output_text: '{"category":"bad"}' }, 'provider_unavailable'],
    [{ status: 'completed', error: { code: 'x' }, output_text: '{"category":"bad"}' }, 'provider_unavailable'],
    [{ status: 'completed', output: [{ type: 'reasoning', content: [{ type: 'output_text', text: '{"category":"bad"}' }] }] }, 'invalid_json'],
    [{ status: 'completed', output: [{ type: 'message', role: 'user', content: [{ type: 'output_text', text: '{"category":"bad"}' }] }] }, 'invalid_json']
  ]) {
    const provider = createOpenAIResponsesProvider({ apiKey: 'secret', model: 'm', fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }) });
    assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema }), { ok: false, code });
  }
  const provider = createOpenAIResponsesProvider({ apiKey: 'secret', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"category":"billing"}' }] }] }), { status: 200 }) });
  assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: schema }), { ok: true, outputText: '{"category":"billing"}' });
});

test('task registration fails fast and end-to-end support task uses no travel contract', async () => {
  assert.throws(() => createStructuredTaskRunner({ provider: { generate() {} }, tasks: [{ ...task }, { ...task }] }), /duplicate/);
  for (const badTask of [{ ...task, id: '' }, { ...task, version: '' }, { ...task, systemPrompt: '' }, { ...task, schemaName: '' }, { ...task, jsonSchema: [] }, { ...task, validateOutput: null }]) {
    assert.throws(() => createStructuredTaskRunner({ provider: { generate() {} }, tasks: [badTask] }), /malformed/);
  }
  let validated = 0;
  const provider = createOpenAIResponsesProvider({ apiKey: 'mock', model: 'mock', fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); assert.equal(body.text.format.name, 'support_classification');
    assert.equal(body.input[0].content[0].text.includes('travel'), false);
    return new Response(JSON.stringify({ status: 'completed', output_text: '{"category":" billing ","priority":"high"}' }), { status: 200 });
  } });
  const runner = createStructuredTaskRunner({ enabled: true, provider, tasks: [{ ...task, normalizeOutput: (v) => ({ ...v, category: v.category.trim() }), validateOutput: (v) => { validated++; return v.category === 'billing' && v.priority === 'high'; } }] });
  assert.deepEqual(await runner.run({ taskId: task.id, text: 'Invoice is incorrect' }), { ok: true, value: { category: 'billing', priority: 'high' }, taskVersion: '1' });
  assert.equal(validated, 1);
  const failedProvider = createOpenAIResponsesProvider({ apiKey: 'mock', model: 'mock', fetchImpl: async () => new Response(JSON.stringify({ status: 'failed', error: { code: 'bad' } }), { status: 200 }) });
  const failedRunner = createStructuredTaskRunner({ enabled: true, provider: failedProvider, tasks: [{ ...task, validateOutput: () => { throw new Error('must not validate'); } }] });
  assert.deepEqual(await failedRunner.run({ taskId: task.id, text: 'x' }), { ok: false, code: 'provider_unavailable' });
});

test('runner sanitizes custom provider failures', async () => {
  const runner = createStructuredTaskRunner({ enabled: true, tasks: [task], provider: { generate: async () => ({ ok: false, code: 'rate_limited', secret: 'PRIVATE_BODY' }) } });
  const known = await runner.run({ taskId: task.id, text: 'x' });
  assert.deepEqual(known, { ok: false, code: 'rate_limited' });
  assert.equal(Object.hasOwn(known, 'secret'), false);
  const unknown = createStructuredTaskRunner({ enabled: true, tasks: [task], provider: { generate: async () => ({ ok: false, code: 'weird', secret: 'PRIVATE_BODY' }) } });
  assert.deepEqual(await unknown.run({ taskId: task.id, text: 'x' }), { ok: false, code: 'provider_unavailable' });
});

test('DashScope provider sends compatible strict request and supports a non-travel task', async () => {
  let seen;
  const provider = createDashscopeCompatibleProvider({ apiKey: ' secret ', workspaceId: ' ws-1 ', model: 'support-model', fetchImpl: async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"category":"billing"}' } }] }), { status: 200 });
  } });
  const result = await provider.generate({ systemPrompt: 'Classify support.', userText: 'Invoice issue', schemaName: 'support', jsonSchema: { type: 'object' } });
  assert.deepEqual(result, { ok: true, outputText: '{"category":"billing"}' });
  assert.equal(seen.url, 'https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer secret');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'Classify support.' }, { role: 'user', content: 'Invoice issue' }]);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'support', strict: true, schema: { type: 'object' } } });
  assert.equal(body.enable_thinking, false); assert.equal(body.enable_search, false); assert.equal(body.stream, false); assert.equal(body.temperature, 0.1); assert.equal(body.n, 1);
  assert.equal(body.max_tokens, 4096); assert.equal('tools' in body, false);
});

test('DashScope provider enforces a server-side output token bound', () => {
  for (const maxOutputTokens of [0, -1, NaN, Infinity, 9000, 1.5])
    assert.throws(() => createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', maxOutputTokens }), TypeError);
  assert.doesNotThrow(() => createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', maxOutputTokens: 8192 }));
  assert.throws(() => createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', outputTokenLimitField: 'other' }), TypeError);
});

test('DashScope provider can bound total completion tokens for supported models', async () => {
  let body;
  const provider = createDashscopeCompatibleProvider({
    apiKey: 'k', workspaceId: 'w', model: 'qwen3.8-flash',
    maxOutputTokens: 4096,
    outputTokenLimitField: 'max_completion_tokens',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }), { status: 200 });
    },
  });
  assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: true, outputText: '{}' });
  assert.equal(body.max_completion_tokens, 4096);
  assert.equal('max_tokens' in body, false);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.n, 1);
});

test('DashScope provider maps failures, abort, body cap, and free-tier callback without leaking body', async () => {
  for (const [status, code] of [[400, 'auth_or_config'], [401, 'auth_or_config'], [402, 'auth_or_config'], [403, 'auth_or_config'], [404, 'auth_or_config'], [422, 'auth_or_config'], [429, 'rate_limited'], [500, 'provider_unavailable']]) {
    const provider = createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', fetchImpl: async () => new Response('PRIVATE_PROVIDER_BODY', { status }) });
    assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: false, code });
  }
  let callbacks = 0;
  const quota = createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', onFreeTierQuotaExhausted: () => { callbacks++; throw new Error('ignored'); }, fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'AllocationQuota.FreeTierOnly', message: 'PRIVATE' } }), { status: 403 }) });
  assert.deepEqual(await quota.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: false, code: 'auth_or_config' });
  assert.equal(callbacks, 1);
  const oversized = createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', fetchImpl: async () => new Response('x'.repeat(65537), { status: 200 }) });
  assert.deepEqual(await oversized.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: false, code: 'invalid_json' });
  const controller = new AbortController(); controller.abort();
  const aborted = createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', fetchImpl: async () => { throw new Error('abort'); } });
  assert.deepEqual(await aborted.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {}, signal: controller.signal }), { ok: false, code: 'deadline_exceeded' });
});

test('DashScope provider rejects invalid config before fetch and maps output termination', async () => {
  for (const options of [{ apiKey: '', workspaceId: 'w', model: 'm' }, { apiKey: 'k', workspaceId: 'bad/path', model: 'm' }, { apiKey: 'k', workspaceId: 'w', model: '' }]) {
    let called = false;
    const provider = createDashscopeCompatibleProvider({ ...options, fetchImpl: async () => { called = true; throw new Error('must not call'); } });
    assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: false, code: 'auth_or_config' });
    assert.equal(called, false);
  }
  for (const [finish_reason, code] of [['length', 'invalid_json'], ['tool_calls', 'provider_unavailable']]) {
    const provider = createDashscopeCompatibleProvider({ apiKey: 'k', workspaceId: 'w', model: 'm', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: '{}' } }] }), { status: 200 }) });
    assert.deepEqual(await provider.generate({ systemPrompt: 's', userText: 'u', schemaName: 'n', jsonSchema: {} }), { ok: false, code });
  }
});
