/**
 * 本地模型评测：用 Ollama 里的免费模型跑 30 题的“需求理解”环节。
 *
 * 在自己的电脑上运行（需要 Ollama 已启动）：
 *   cd site
 *   OLLAMA_MODEL=qwen3:8b OLLAMA_RUNS=3 npm run eval:ollama
 * 可选环境变量：OLLAMA_URL（默认 http://127.0.0.1:11434）、OLLAMA_TASKS（如 "01,05,22"）、
 * OLLAMA_THINK=1（开启 qwen3 思考模式，默认关闭）、OLLAMA_DEADLINE_MS（默认 120000）。
 *
 * 口径：
 * - 不花任何线上额度；结果只代表所选本地模型，不代表线上 glm-5.3-flash。
 * - 为了测模型本身，每题都强制走模型路径；同时记录“规则优先”闸门在线上会不会真的调用模型。
 * - 模型草稿必须通过格式、证据、语义三道校验才被采纳，否则整次回退规则；这里记录每次卡在哪一道。
 * - 每跑完一次就追加写入 .jsonl，中途停止也不丢已跑的结果。
 */
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, it } from 'vitest';

import { assessRulesTier } from '@/app/lib/interpretation-tier';
import { interpretTripRequest } from '@/app/lib/nlu-orchestrator';
import {
  PLANNER_VERSION,
  POI_DATASET,
  parseTripRequest,
  planTrip,
  type ParsedTripRequest,
} from '@/app/lib/planner';
import {
  validateDraftEvidence,
  validateDraftSchema,
  validateDraftSemantics,
} from '@/app/lib/trip-request-draft-v2-runtime';

import { normalizeProviderDraft, PROMPT_VERSION } from '../bff/provider-shared';
import { createOllamaDraftAdapter, type OllamaCallRecord } from './ollama-draft-adapter';
import taskSet from './tasks.v0.json';

const BASE_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:8b';
const RUNS = Math.max(1, Number(process.env.OLLAMA_RUNS ?? 3));
const THINK = process.env.OLLAMA_THINK === '1';
const NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 16_384);
const DEADLINE_MS = Number(process.env.OLLAMA_DEADLINE_MS ?? 120_000);
/** 回放模式：用之前保存的模型原始输出重新走一遍校验，不调用 Ollama。 */
const REPLAY = process.env.OLLAMA_REPLAY ?? '';
const replayDrafts = new Map<string, string | null>();
if (REPLAY)
  for (const line of readFileSync(REPLAY, 'utf8').split('\n').filter(Boolean)) {
    const item = JSON.parse(line) as { taskId: string; run: number; raw: string | null };
    replayDrafts.set(`${item.taskId}#${item.run}`, item.raw);
  }
const ONLY = (process.env.OLLAMA_TASKS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
// 第 29 题是“模型超时”故障注入，不是理解能力题，这里不跑。
const SKIP = new Set(['29']);

interface Task {
  id: string;
  kind: string;
  support: string;
  text: string;
  editedText?: string;
}

interface RunRecord {
  taskId: string;
  run: number;
  input: string;
  productionTier: 'rules' | 'model';
  call: Omit<OllamaCallRecord, 'rawContent' | 'parsedDraft'> & { rawContentChars: number };
  firstFailure: { stage: string; reason: string; path: string | null; message: string } | null;
  acceptedMode: string;
  fallbackReasonCode: string | null;
  differsFromRules: string[];
  planOk: boolean;
  rulesPlanOk: boolean;
  planHardFailures: number | null;
}

const stamp = new Date().toISOString().slice(0, 10);
const safeModel = MODEL.replace(/[^a-z0-9.]+/gi, '-');
const outDir = fileURLToPath(new URL('./reports/', import.meta.url));
const base = `${outDir}ollama-${safeModel}${THINK ? '-think' : ''}-${stamp}${REPLAY ? '-replay' : ''}`;
const records: RunRecord[] = [];

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function comparable(request: ParsedTripRequest) {
  return {
    days: request.days,
    origin: request.origin.refId,
    start: request.dailyWindow.startMinutes,
    pace: request.pace,
    venue: request.venuePreference.value,
    geography: request.geography.scope,
    experiences: request.experiencePreferences,
    lowWalking: request.lowWalking,
    family: request.family,
    mustInclude: [...request.mustIncludePoiIds].sort(),
    exclude: [...request.excludePoiIds].sort(),
    budget: request.totalBudgetCents,
    party: [
      request.pricingParty.adultFullFareCount,
      request.pricingParty.concessionEligibleCount,
      request.pricingParty.childAges.join('/'),
      request.pricingParty.totalTravelers,
    ],
    lodging: request.costAssumptions?.accommodation
      ? [
          request.costAssumptions.accommodation.perNightMinCents,
          request.costAssumptions.accommodation.perNightMaxCents,
          request.costAssumptions.accommodation.nights,
        ]
      : null,
    food: request.costAssumptions?.food
      ? [
          request.costAssumptions.food.perPersonPerDayMinCents,
          request.costAssumptions.food.perPersonPerDayMaxCents,
        ]
      : null,
    blocked: request.errors.length > 0,
  };
}

function diff(a: ParsedTripRequest, b: ParsedTripRequest): string[] {
  const left = comparable(a) as Record<string, unknown>;
  const right = comparable(b) as Record<string, unknown>;
  return Object.keys(left).filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  );
}

beforeAll(async () => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${base}.jsonl`, '');
  writeFileSync(`${base}-drafts.jsonl`, '');
  if (REPLAY) return;
  let tags: { models?: Array<{ name: string }> };
  try {
    const response = await fetch(`${BASE_URL}/api/tags`);
    tags = (await response.json()) as typeof tags;
  } catch (error) {
    throw new Error(
      `连不上 Ollama（${BASE_URL}）。请先启动 Ollama（打开 Ollama 应用或运行 ollama serve）。原始错误：${String(error)}`,
    );
  }
  const names = (tags.models ?? []).map((item) => item.name);
  if (!names.includes(MODEL))
    throw new Error(`Ollama 里没有模型 ${MODEL}。现有：${names.join('、') || '无'}`);
});

const tasks = (taskSet.tasks as Task[]).filter(
  (task) =>
    !SKIP.has(task.id) &&
    (ONLY.length === 0 || ONLY.includes(task.id)) &&
    (!REPLAY || replayDrafts.has(`${task.id}#1`)),
);

for (const task of tasks) {
  it(`task ${task.id}`, async () => {
    const input = task.id === '22' ? (task.editedText as string) : task.text;
    const rulesRequest = parseTripRequest(input);
    const rulesPlanOk = planTrip(rulesRequest).ok;
    const productionTier = assessRulesTier(rulesRequest).verdict;
    for (let run = 1; run <= RUNS; run += 1) {
      let call: OllamaCallRecord | null = null;
      const adapter = REPLAY
        ? {
            extractDraft: async (input: { datasetVersion: string }) => {
              const raw = replayDrafts.get(`${task.id}#${run}`) ?? null;
              let parsed: unknown = null;
              try {
                parsed = normalizeProviderDraft(JSON.parse(raw ?? ''));
              } catch {
                parsed = null;
              }
              call = { ok: parsed !== null, httpStatus: null, error: parsed ? null : 'invalid_json', rawContent: raw, parsedDraft: parsed, wallMs: 0, promptTokens: null, outputTokens: null, contextFull: false };
              return parsed === null
                ? ({ ok: false, code: 'invalid_json' } as const)
                : ({ ok: true, draft: parsed, promptVersion: PROMPT_VERSION, datasetVersion: input.datasetVersion } as const);
            },
          }
        : createOllamaDraftAdapter({
            baseUrl: BASE_URL,
            model: MODEL,
            think: THINK,
            numCtx: NUM_CTX,
            onCall: (record) => {
              call = record;
            },
          });
      const outcome = await interpretTripRequest({
        rawText: input,
        sourceFingerprint: `${task.id}-${run}`,
        adapter,
        deadlineMs: DEADLINE_MS,
      });
      const callRecord = call as OllamaCallRecord | null;
      let firstFailure: RunRecord['firstFailure'] = null;
      if (callRecord?.ok) {
        const schema = validateDraftSchema(callRecord.parsedDraft);
        const check = !schema.ok
          ? schema
          : (() => {
              const evidence = validateDraftEvidence(schema.draft, input);
              return evidence.ok ? validateDraftSemantics(schema.draft, input) : evidence;
            })();
        if (!check.ok)
          firstFailure = {
            stage: check.issue.stage,
            reason: check.issue.reason,
            path: check.issue.path,
            message: check.message,
          };
      }
      const request = outcome.status === 'complete' ? outcome.request : rulesRequest;
      const plan = planTrip(request);
      const record: RunRecord = {
        taskId: task.id,
        run,
        input,
        productionTier,
        call: {
          ok: callRecord?.ok ?? false,
          httpStatus: callRecord?.httpStatus ?? null,
          error: callRecord ? callRecord.error : 'no_call',
          wallMs: callRecord?.wallMs ?? 0,
          promptTokens: callRecord?.promptTokens ?? null,
          outputTokens: callRecord?.outputTokens ?? null,
          contextFull: callRecord?.contextFull ?? false,
          rawContentChars: callRecord?.rawContent?.length ?? 0,
        },
        firstFailure,
        acceptedMode: outcome.status === 'complete' ? outcome.diagnostics.acceptedMode : outcome.status,
        fallbackReasonCode:
          outcome.status === 'complete' ? outcome.diagnostics.fallbackReasonCode : null,
        differsFromRules:
          outcome.status === 'complete' && outcome.diagnostics.acceptedMode === 'llm'
            ? diff(outcome.request, rulesRequest)
            : [],
        planOk: plan.ok,
        rulesPlanOk,
        planHardFailures: plan.ok ? plan.result.summary.hardFailures : null,
      };
      records.push(record);
      appendFileSync(`${base}.jsonl`, `${JSON.stringify(record)}\n`);
      // 原始模型输出单独存一份，便于逐条分析（输入都是固定评测题，不含个人信息）。
      appendFileSync(
        `${base}-drafts.jsonl`,
        `${JSON.stringify({ taskId: task.id, run, raw: callRecord?.rawContent ?? null })}\n`,
      );
      console.log(
        `[${task.id}#${run}] ${record.acceptedMode}${record.firstFailure ? ` (${record.firstFailure.reason} @ ${record.firstFailure.path})` : ''} ${record.call.wallMs} ms`,
      );
    }
  });
}

afterAll(() => {
  if (records.length === 0) return;
  const accepted = records.filter((r) => r.acceptedMode === 'llm');
  const byReason = new Map<string, number>();
  for (const r of records.filter((item) => item.acceptedMode !== 'llm')) {
    const key = r.firstFailure
      ? `${r.firstFailure.reason} @ ${r.firstFailure.path ?? '-'}`
      : (r.fallbackReasonCode ?? r.call.error ?? 'unknown');
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  const walls = records.map((r) => r.call.wallMs).sort((a, b) => a - b);
  const pct = (p: number) => walls[Math.min(walls.length - 1, Math.floor(p * walls.length))];
  const productionModelRuns = records.filter((r) => r.productionTier === 'model');
  const meta = {
    model: MODEL,
    think: THINK,
    numCtx: NUM_CTX,
    runsPerTask: RUNS,
    promptVersion: PROMPT_VERSION,
    plannerVersion: PLANNER_VERSION,
    poiDataVersion: POI_DATASET.dataVersion,
    gitCommit: git('rev-parse --short HEAD') ?? 'unknown',
    workingTreeDirty: (git('status --porcelain') ?? '').length > 0,
    date: stamp,
    note: '本地模型，不代表线上模型；未花线上额度。',
    replayOf: REPLAY || null,
  };
  const summary = {
    runs: records.length,
    tasks: new Set(records.map((r) => r.taskId)).size,
    llmAccepted: `${accepted.length}/${records.length}`,
    llmAcceptedWhereProductionWouldCallModel: `${productionModelRuns.filter((r) => r.acceptedMode === 'llm').length}/${productionModelRuns.length}`,
    acceptedButDiffersFromRules: accepted.filter((r) => r.differsFromRules.length > 0).length,
    planOkChangedVsRules: records.filter((r) => r.planOk !== r.rulesPlanOk).length,
    contextFullRuns: records.filter((r) => r.call.contextFull).length,
    latencyMs: { p50: pct(0.5), p90: pct(0.9), max: walls[walls.length - 1] },
  };
  writeFileSync(
    `${base}.json`,
    `${JSON.stringify({ meta, summary, rejectionReasons: Object.fromEntries(byReason), records }, null, 2)}\n`,
  );
  const lines = [
    `# 本地模型评测：${MODEL}（${stamp}）`,
    '',
    '> 由 `npm run eval:ollama` 生成。本地模型，不代表线上模型；未花线上额度。',
    '',
    '| 项 | 值 |',
    '|---|---|',
    ...Object.entries(meta).map(([k, v]) => `| ${k} | ${String(v)} |`),
    '',
    '## 汇总',
    '',
    '| 指标 | 值 |',
    '|---|---|',
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : String(v)} |`),
    '',
    '## 未采纳原因（第一道未通过的校验）',
    '',
    '| 原因 | 次数 |',
    '|---|---|',
    ...[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## 逐题',
    '',
    '| ID | 线上是否会调模型 | 采纳次数 | 未采纳原因 | 与规则不同的字段 | 平均耗时 ms |',
    '|---|---|---|---|---|---|',
  ];
  for (const id of new Set(records.map((r) => r.taskId))) {
    const rs = records.filter((r) => r.taskId === id);
    const reasons = [...new Set(rs.filter((r) => r.firstFailure).map((r) => `${r.firstFailure?.reason}：${r.firstFailure?.message}`))];
    const diffs = [...new Set(rs.flatMap((r) => r.differsFromRules))];
    const avg = Math.round(rs.reduce((sum, r) => sum + r.call.wallMs, 0) / rs.length);
    lines.push(
      `| ${id} | ${rs[0].productionTier === 'model' ? '会' : '不会（规则已够用）'} | ${rs.filter((r) => r.acceptedMode === 'llm').length}/${rs.length} | ${reasons.join('<br>') || '—'} | ${diffs.join('、') || '—'} | ${avg} |`,
    );
  }
  writeFileSync(`${base}.md`, `${lines.join('\n')}\n`);
});
