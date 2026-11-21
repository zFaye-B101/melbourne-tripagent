/**
 * 本地 Ollama 适配器：只供评测脚本在开发者自己的电脑上使用，不打包进网页、不上线。
 *
 * 与线上云端适配器使用同一份提示词（schemaPrompt / PROMPT_VERSION）和同一份
 * strict JSON Schema；另外把 Schema 作为 Ollama 的 `format` 传入，让本地模型做
 * 结构化输出。返回的草稿与线上一样，必须再经过格式、证据、语义三道校验。
 */
import type { NluDraftAdapter } from '@/app/lib/nlu-contract';

import {
  normalizeProviderDraft,
  PROMPT_VERSION,
  schemaPrompt,
  structuredDraftSchema,
} from '../bff/provider-shared';

export interface OllamaCallRecord {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  rawContent: string | null;
  parsedDraft: unknown;
  wallMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
  /** 提示词 + 输出用满了上下文，说明很可能被截断，本次结果不可信。 */
  contextFull: boolean;
}

export interface OllamaAdapterOptions {
  baseUrl: string;
  model: string;
  /** qwen3 系列默认会先“思考”；评测默认关闭以贴近线上 minimal 推理设置。 */
  think: boolean;
  /**
   * 上下文长度。Ollama 默认只有 4096，而本项目的提示词 + Schema 约 8k token：
   * 不调大时提示词会被截掉、输出也会在 4096 处被截断（2026-09-28 试跑时实际发生）。
   */
  numCtx: number;
  onCall?: (record: OllamaCallRecord) => void;
}

export function createOllamaDraftAdapter(
  options: OllamaAdapterOptions,
): NluDraftAdapter {
  return {
    async extractDraft(input, { signal }) {
      const started = Date.now();
      const record: OllamaCallRecord = {
        ok: false,
        httpStatus: null,
        error: null,
        rawContent: null,
        parsedDraft: null,
        wallMs: 0,
        promptTokens: null,
        outputTokens: null,
        contextFull: false,
      };
      const finish = () => {
        record.wallMs = Date.now() - started;
        options.onCall?.(record);
      };
      try {
        const response = await fetch(`${options.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: options.model,
            stream: false,
            think: options.think,
            format: structuredDraftSchema(),
            options: { temperature: 0, num_ctx: options.numCtx },
            messages: [
              { role: 'system', content: schemaPrompt() },
              { role: 'user', content: input.text },
            ],
          }),
        });
        record.httpStatus = response.status;
        if (!response.ok) {
          record.error = `HTTP ${response.status}`;
          finish();
          return { ok: false, code: 'provider_unavailable' };
        }
        const body = (await response.json()) as {
          message?: { content?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        record.promptTokens = body.prompt_eval_count ?? null;
        record.outputTokens = body.eval_count ?? null;
        record.contextFull =
          (record.promptTokens ?? 0) + (record.outputTokens ?? 0) >= options.numCtx;
        record.rawContent = body.message?.content ?? null;
        let draft: unknown;
        try {
          draft = normalizeProviderDraft(JSON.parse(record.rawContent ?? ''));
        } catch {
          record.error = 'invalid_json';
          finish();
          return { ok: false, code: 'invalid_json' };
        }
        record.parsedDraft = draft;
        record.ok = true;
        finish();
        return {
          ok: true,
          draft,
          promptVersion: PROMPT_VERSION,
          datasetVersion: input.datasetVersion,
        };
      } catch (error) {
        record.error = signal.aborted ? 'deadline_exceeded' : String(error);
        finish();
        return {
          ok: false,
          code: signal.aborted ? 'deadline_exceeded' : 'provider_unavailable',
        };
      }
    },
  };
}
