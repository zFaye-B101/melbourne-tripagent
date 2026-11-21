/**
 * 用一个假的本地 HTTP 服务模拟 Ollama，检查适配器的请求形状与失败映射。
 * 不需要真的安装 Ollama，也不调用任何模型。
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import exampleDraft from '../../data/examples/trip-request-v2.example.json';
import { afterEach, describe, expect, it } from 'vitest';

import { POI_DATASET } from '@/app/lib/planner';

import { PROMPT_VERSION } from '../bff/provider-shared';
import { createOllamaDraftAdapter, type OllamaCallRecord } from './ollama-draft-adapter';

let server: Server | null = null;

async function fakeOllama(
  handler: (body: Record<string, unknown>) => { status: number; json: unknown },
): Promise<{ url: string; bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      bodies.push(body);
      const reply = handler(body);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const input = { text: '墨尔本玩 2 天', locale: 'zh-CN' as const, datasetVersion: POI_DATASET.dataVersion };

describe('createOllamaDraftAdapter', () => {
  it('sends the production prompt, the strict schema as format, temperature 0 and think=false', async () => {
    const fake = await fakeOllama(() => ({
      status: 200,
      json: { message: { content: JSON.stringify(exampleDraft) }, prompt_eval_count: 10, eval_count: 20 },
    }));
    let record: OllamaCallRecord | null = null;
    const adapter = createOllamaDraftAdapter({
      baseUrl: fake.url,
      model: 'qwen3:8b',
      think: false,
      numCtx: 16384,
      onCall: (item) => (record = item),
    });
    const result = await adapter.extractDraft(input, {
      signal: new AbortController().signal,
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promptVersion).toBe(PROMPT_VERSION);
    const body = fake.bodies[0];
    expect(body.model).toBe('qwen3:8b');
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_ctx: 16384 });
    expect(JSON.stringify(body.format)).toContain('costAssumptions');
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: '墨尔本玩 2 天' });
    expect((record as OllamaCallRecord | null)?.outputTokens).toBe(20);
  });

  it('maps non-JSON output and HTTP errors to fallback codes', async () => {
    const fake = await fakeOllama((body) =>
      body.model === 'broken'
        ? { status: 500, json: { error: 'boom' } }
        : { status: 200, json: { message: { content: 'not json' } } },
    );
    const signal = new AbortController().signal;
    const bad = await createOllamaDraftAdapter({ baseUrl: fake.url, model: 'x', think: false, numCtx: 16384 }).extractDraft(input, { signal, deadlineMs: 5_000 });
    expect(bad).toEqual({ ok: false, code: 'invalid_json' });
    const down = await createOllamaDraftAdapter({ baseUrl: fake.url, model: 'broken', think: false, numCtx: 16384 }).extractDraft(input, { signal, deadlineMs: 5_000 });
    expect(down).toEqual({ ok: false, code: 'provider_unavailable' });
  });
});
