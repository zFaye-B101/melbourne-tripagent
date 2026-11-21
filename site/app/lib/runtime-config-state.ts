/**
 * 运行时配置的当前状态。
 *
 * 这里只保存“页面当前采用哪一版配置”，不负责取数，也不 import planner，
 * 这样 planner、提示词适配器和页面都能读它，而不会形成循环依赖。
 * 初始值是打包时的那份配置，所以网络失败时行为和以前完全一致。
 */
import promptJson from '@/config/prompt.v2.10.json';
import rulesJson from '@/config/rules.v1.json';

export interface RuntimeRules {
  version: string;
  minRecognizedFields: number;
  defaultStartMinutes: number;
  defaultEndMinutes: number;
  earliestStartMinutes: number;
  latestStartMinutes: number;
  lunchStartMinutes: number;
  latestLunchStartMinutes: number;
  lunchMinutes: number;
  extraPoiAliases: Record<string, string[]>;
}

export interface RuntimePrompt {
  version: string;
  text: string;
}

export interface RuntimeConfigState {
  version: string;
  rules: RuntimeRules;
  prompt: RuntimePrompt;
  loadedAt: string | null;
}

export const DEFAULT_RUNTIME_RULES = rulesJson as RuntimeRules;
export const DEFAULT_RUNTIME_PROMPT = promptJson as RuntimePrompt;

const bundledState = (): RuntimeConfigState => ({
  version: 'bundled',
  rules: structuredClone(DEFAULT_RUNTIME_RULES),
  prompt: structuredClone(DEFAULT_RUNTIME_PROMPT),
  loadedAt: null,
});

let current = bundledState();
const listeners = new Set<(state: RuntimeConfigState) => void>();

export function getRuntimeConfig(): RuntimeConfigState {
  return current;
}

export function setRuntimeConfig(state: RuntimeConfigState): void {
  current = state;
  for (const listener of listeners) listener(current);
}

export function subscribeRuntimeConfig(
  listener: (state: RuntimeConfigState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetRuntimeConfig(): void {
  current = bundledState();
  for (const listener of listeners) listener(current);
}
