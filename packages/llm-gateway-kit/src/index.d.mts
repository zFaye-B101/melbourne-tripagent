export type ProviderErrorCode = 'auth_or_config' | 'rate_limited' | 'deadline_exceeded' | 'provider_unavailable' | 'invalid_json';
export type ProviderResult = { ok: true; outputText: string } | { ok: false; code: ProviderErrorCode };
export interface ResponsesProvider { generate(input: { systemPrompt: string; userText: string; schemaName: string; jsonSchema: Record<string, unknown>; signal?: AbortSignal }): Promise<ProviderResult>; }
export function createOpenAIResponsesProvider(options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch; maxOutputTokens?: number }): ResponsesProvider;
export function createDashscopeCompatibleProvider(options: { apiKey?: string; workspaceId?: string; model?: string; fetchImpl?: typeof fetch; maxOutputTokens?: number; outputTokenLimitField?: 'max_tokens' | 'max_completion_tokens'; onFreeTierQuotaExhausted?: () => void }): ResponsesProvider;
export interface StructuredTask<T = unknown> { id: string; version: string; systemPrompt: string; schemaName: string; jsonSchema: Record<string, unknown>; normalizeOutput?: (value: unknown) => unknown; validateOutput: (value: unknown) => boolean; }
export type RunnerResult<T> = { ok: true; value: T; taskVersion: string } | { ok: false; code: string };
export function createStructuredTaskRunner<T = unknown>(options: { tasks: StructuredTask<T>[] | Record<string, StructuredTask<T>>; provider: ResponsesProvider; enabled?: boolean }): { run(input: { taskId: string; text: string; signal?: AbortSignal }): Promise<RunnerResult<T>> };
