const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_OUTPUT_TOKENS_CAP = 8192;
const PROVIDER_ERROR_CODES = new Set(['auth_or_config', 'rate_limited', 'deadline_exceeded', 'provider_unavailable', 'invalid_json']);
const DASHSCOPE_BODY_CAP = 65536;

/** @typedef {'auth_or_config'|'rate_limited'|'deadline_exceeded'|'provider_unavailable'|'invalid_json'} ProviderErrorCode */

export function createOpenAIResponsesProvider({ apiKey, model, fetchImpl = globalThis.fetch, maxOutputTokens = 1600 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isFinite(maxOutputTokens) || !Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > MAX_OUTPUT_TOKENS_CAP) {
    throw new TypeError(`maxOutputTokens must be a positive integer <= ${MAX_OUTPUT_TOKENS_CAP}`);
  }
  return {
    async generate({ systemPrompt, userText, schemaName, jsonSchema, signal } = {}) {
      if (typeof apiKey !== 'string' || !apiKey || typeof model !== 'string' || !model) return { ok: false, code: 'auth_or_config' };
      if (typeof systemPrompt !== 'string' || typeof userText !== 'string' || typeof schemaName !== 'string' || !jsonSchema) {
        return { ok: false, code: 'provider_unavailable' };
      }
      try {
        const response = await fetchImpl(RESPONSES_URL, {
          method: 'POST', signal,
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model, store: false, max_output_tokens: maxOutputTokens,
            input: [
              { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
              { role: 'user', content: [{ type: 'input_text', text: userText }] }
            ],
            text: { format: { type: 'json_schema', name: schemaName, strict: true, schema: jsonSchema } }
          })
        });
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth_or_config' };
        if (response.status === 429) return { ok: false, code: 'rate_limited' };
        if (!response.ok) return { ok: false, code: 'provider_unavailable' };
        let payload;
        try { payload = await response.json(); } catch { return { ok: false, code: 'provider_unavailable' }; }
        if (payload?.status !== 'completed' || payload?.error != null) return { ok: false, code: 'provider_unavailable' };
        const outputText = typeof payload?.output_text === 'string'
          ? payload.output_text
          : payload?.output?.filter((item) => item?.type === 'message' &&
              (item?.status == null || item.status === 'completed') &&
              (item?.role == null || item.role === 'assistant'))
              .flatMap((item) => item?.content ?? [])
              .filter((item) => item?.type === 'output_text')
              .map((item) => item?.text).find((value) => typeof value === 'string');
        if (!outputText) return { ok: false, code: 'invalid_json' };
        return { ok: true, outputText };
      } catch {
        if (signal?.aborted) return { ok: false, code: 'deadline_exceeded' };
        return { ok: false, code: 'provider_unavailable' };
      }
    }
  };
}

export function createDashscopeCompatibleProvider({ apiKey, workspaceId, model, fetchImpl = globalThis.fetch, maxOutputTokens = 4096, outputTokenLimitField = 'max_tokens', onFreeTierQuotaExhausted } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > MAX_OUTPUT_TOKENS_CAP)
    throw new TypeError(`maxOutputTokens must be a positive integer <= ${MAX_OUTPUT_TOKENS_CAP}`);
  if (outputTokenLimitField !== 'max_tokens' && outputTokenLimitField !== 'max_completion_tokens')
    throw new TypeError('outputTokenLimitField is invalid');
  return {
    async generate({ systemPrompt, userText, schemaName, jsonSchema, signal } = {}) {
      const workspace = typeof workspaceId === 'string' ? workspaceId.trim() : '';
      const key = typeof apiKey === 'string' ? apiKey.trim() : '';
      const selectedModel = typeof model === 'string' ? model.trim() : '';
      if (!key || !workspace || !/^[A-Za-z0-9-]{1,128}$/.test(workspace) || !selectedModel) return { ok: false, code: 'auth_or_config' };
      if (typeof systemPrompt !== 'string' || typeof userText !== 'string' || typeof schemaName !== 'string' || !jsonSchema) {
        return { ok: false, code: 'provider_unavailable' };
      }
      const endpoint = `https://${workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST', signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText }
            ],
            response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchema } },
            enable_thinking: false,
            enable_search: false,
            stream: false,
            temperature: 0.1,
            n: 1,
            [outputTokenLimitField]: maxOutputTokens,
          })
        });
        const body = await readDashscopeJsonBody(response);
        const payload = body.ok ? body.value : undefined;
        const providerError = payload?.error ?? (payload?.code === undefined ? undefined : { code: payload.code, message: payload.message, type: payload.type });
        if (!response.ok || providerError !== undefined) {
          const errorCode = typeof providerError === 'string' ? providerError : providerError === undefined ? '' : JSON.stringify(providerError);
          if (/AllocationQuota|insufficient_quota|FreeTierOnly/i.test(errorCode) && typeof onFreeTierQuotaExhausted === 'function') {
            try { onFreeTierQuotaExhausted(); } catch { /* callback is advisory */ }
          }
          return { ok: false, code: mapDashscopeFailure(response.status) };
        }
        if (!body.ok) return { ok: false, code: 'invalid_json' };
        const choice = payload?.choices?.[0];
        if (choice?.finish_reason !== 'stop') return { ok: false, code: choice?.finish_reason === 'length' ? 'invalid_json' : 'provider_unavailable' };
        const outputText = choice?.message?.content;
        if (typeof outputText !== 'string' || outputText.trim() === '') return { ok: false, code: 'invalid_json' };
        return { ok: true, outputText };
      } catch {
        if (signal?.aborted) return { ok: false, code: 'deadline_exceeded' };
        return { ok: false, code: 'provider_unavailable' };
      }
    }
  };
}

async function readDashscopeJsonBody(response) {
  try {
    const reader = response.body?.getReader();
    if (!reader) return { ok: true, value: await response.json() };
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > DASHSCOPE_BODY_CAP) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch { return { ok: false }; }
}

function mapDashscopeFailure(status) {
  if ([400, 401, 402, 403, 404, 422].includes(status)) return 'auth_or_config';
  if (status === 429) return 'rate_limited';
  return 'provider_unavailable';
}

export function createStructuredTaskRunner({ tasks, provider, enabled = false } = {}) {
  if (!provider || typeof provider.generate !== 'function') throw new TypeError('provider.generate is required');
  const list = Array.isArray(tasks) ? tasks : Object.values(tasks ?? {});
  const definitions = new Map();
  for (const task of list) {
    if (!task || typeof task !== 'object' ||
      typeof task.id !== 'string' || !task.id.trim() ||
      typeof task.version !== 'string' || !task.version.trim() ||
      typeof task.systemPrompt !== 'string' || !task.systemPrompt.trim() ||
      typeof task.schemaName !== 'string' || !task.schemaName.trim() ||
      !task.jsonSchema || typeof task.jsonSchema !== 'object' || Array.isArray(task.jsonSchema) ||
      typeof task.validateOutput !== 'function') throw new TypeError('malformed task definition');
    if (definitions.has(task.id)) throw new TypeError(`duplicate task id: ${task.id}`);
    definitions.set(task.id, task);
  }
  return {
    async run({ taskId, text, signal } = {}) {
      const task = definitions.get(taskId);
      if (!task) return { ok: false, code: 'unknown_task' };
      if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'empty_text' };
      if (!enabled) return { ok: false, code: 'disabled' };
      let response;
      try {
        response = await provider.generate({ systemPrompt: task.systemPrompt, userText: text, schemaName: task.schemaName, jsonSchema: task.jsonSchema, signal });
      } catch { return { ok: false, code: 'provider_unavailable' }; }
      if (!response?.ok) {
        const code = response?.code;
        return { ok: false, code: PROVIDER_ERROR_CODES.has(code) ? code : 'provider_unavailable' };
      }
      let value;
      try { value = JSON.parse(response.outputText); } catch { return { ok: false, code: 'invalid_json' }; }
      try { if (typeof task.normalizeOutput === 'function') value = task.normalizeOutput(value); } catch { return { ok: false, code: 'invalid_output' }; }
      try { if (typeof task.validateOutput !== 'function' || task.validateOutput(value) !== true) return { ok: false, code: 'invalid_output' }; }
      catch { return { ok: false, code: 'invalid_output' }; }
      return { ok: true, value, taskVersion: task.version };
    }
  };
}
