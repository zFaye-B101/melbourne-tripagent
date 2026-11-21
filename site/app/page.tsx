'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  ImageOff,
  MapPin,
  MessageCircle,
  Pencil,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Users,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FeaturedPois,
  type PoiCardPreference,
} from '@/app/components/featured-pois';
import { DiscoverGrid } from '@/app/components/discover-grid';
import { PoiVisual } from '@/app/components/poi-visual';
import { PreparePreview } from '@/app/components/prepare-preview';
import { ProjectEvidence } from '@/app/components/project-evidence';
import { SiteFooter } from '@/app/components/site-footer';
import { SiteNav } from '@/app/components/site-nav';
import { TripDrawer } from '@/app/components/trip-drawer';
import { TripPreparation } from '@/app/components/trip-preparation';
import { parseAudRangeInput } from '@/app/lib/cost-assumptions';
import { getPoiPhoto } from '@/app/lib/poi-media';
import {
  EXPERIENCE_FACETS,
  POI_DATASET,
  POIS,
  auditReplacementOptions,
  experienceFacetCounts,
  formatTime,
  getAdmissionPriceRecord,
  mergePoiPreferenceConstraints,
  mergeStructuredTripRequest,
  planTrip,
  replaceStopWithPoi,
  type ConstraintCheck,
  type DayPlan,
  type ExperienceFacet,
  type GeoScope,
  type Pace,
  type ParsedTripRequest,
  type PlannerResult,
  type Poi,
  type PreferenceState,
  type StructuredTripSettings,
  type SettingConflictField,
  type VenuePreference,
} from '@/app/lib/planner';
import {
  buildPlanProposal,
  canCommitPlanning,
  isProposalCurrent,
  phaseAfterSourceChange,
  type AgentSessionPhase,
  type PlanProposal,
  type ProposalSummaryItem,
} from '@/app/lib/agent-session';
import {
  canCommitInterpretation,
  interpretTripRequest,
} from '@/app/lib/nlu-orchestrator';
import { interpretTripRequestViaBff } from '@/app/lib/bff-parse-client';
import {
  CLOUD_LLM_DEADLINE_MS,
  isCloudLlmParseConfigured,
  resolveCloudLlmDraftAdapter,
} from '@/app/lib/cloud-llm-config';
import {
  loadRuntimeConfig,
  subscribeRuntimeConfig,
} from '@/app/lib/runtime-config';
import { getRuntimeConfig } from '@/app/lib/runtime-config-state';
import {
  aiParseEndpointForExplicitClick,
  defaultInterpretationModeForUserAction,
  type InterpretationMode,
} from '@/app/lib/ai-parse-opt-in';
import {
  LLM_LOCAL_LIMITS,
  createLlmRequestGuard,
  planAiClick,
  type LlmRequestGuard,
} from '@/app/lib/llm-local-guard';
import {
  createInterpretationCache,
  type InterpretationCache,
} from '@/app/lib/interpretation-cache';
import {
  assessRulesTier,
  planRulesFirstClick,
} from '@/app/lib/interpretation-tier';
import type { InterpretationOutcome } from '@/app/lib/nlu-contract';

const DEFAULT_REQUEST = '';

interface Snapshot {
  result: PlannerResult;
  activeDay: string;
}

interface QuickState {
  days: number | null;
  startMinutes: number | null;
  originText: string;
  geography: GeoScope | null;
  venuePreference: VenuePreference | null;
  pace: Pace | null;
  experiences: Record<ExperienceFacet, PreferenceState>;
  lowWalking: boolean;
  family: boolean;
  dateText: string;
  budgetText: string;
  lodgingPerNightText: string;
  lodgingNightsText: string;
  foodPerDayText: string;
  adults: number;
  concessions: number;
  childAgesText: string;
  partyTouched: boolean;
  paymentMedium: 'contactless' | 'existing_myki' | 'new_physical_myki';
}

const DEFAULT_QUICK: QuickState = {
  days: null,
  startMinutes: null,
  originText: '',
  geography: null,
  venuePreference: null,
  pace: null,
  experiences: {
    museum_exhibition: 'neutral',
    history_heritage: 'neutral',
    parks_gardens: 'neutral',
    river_city_walk: 'neutral',
    city_icons_views: 'neutral',
    performance_music: 'neutral',
    sports_venues: 'neutral',
    market_local_life: 'neutral',
  },
  lowWalking: false,
  family: false,
  dateText: '',
  budgetText: '',
  lodgingPerNightText: '',
  lodgingNightsText: '',
  foodPerDayText: '',
  adults: 1,
  concessions: 0,
  childAgesText: '',
  partyTouched: false,
  paymentMedium: 'contactless',
};

const PROMPT_STARTERS = [
  {
    label: '2 天 · 历史与花园',
    request: '墨尔本玩 2 天，住 CBD，轻松一点，喜欢历史和花园',
  },
  {
    label: '亲子 1 天 · 雨天室内',
    request: '带孩子玩 1 天，下雨也能去，想看博物馆和展览',
  },
  {
    label: '3 天 · CBD 11 点出发',
    request: '墨尔本 3 天，主要在市内，喜欢室外，从 CBD 出发，每天 11 点出门',
  },
  {
    label: '2 天 · 少走路 + 必去',
    request: '玩 2 天，少走路，必去 Melbourne Skydeck，避开水族馆',
  },
];

interface ReplacementTarget {
  dayIndex: number;
  stopIndex: number;
}

interface ModelContextLike {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      execute: (input: unknown) => object | Promise<object>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

export default function Home() {
  const [input, setInput] = useState(DEFAULT_REQUEST);
  const [quick, setQuick] = useState<QuickState>(DEFAULT_QUICK);
  const [poiPreferences, setPoiPreferences] = useState<
    Record<string, PoiCardPreference>
  >({});
  const [tripOpen, setTripOpen] = useState(false);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [activeDay, setActiveDay] = useState('0');
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [replacementTarget, setReplacementTarget] =
    useState<ReplacementTarget | null>(null);
  const [selectedReplacementId, setSelectedReplacementId] = useState('');
  const [clarificationNeeded, setClarificationNeeded] = useState(false);
  const [phase, setPhase] = useState<AgentSessionPhase>('idle');
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusTarget, setSettingsFocusTarget] =
    useState<SettingConflictField | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [runtimeConfigVersion, setRuntimeConfigVersion] = useState(
    () => getRuntimeConfig().version,
  );
  const overviewRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeInterpretationRunRef = useRef(0);
  const activeInterpretationRef = useRef<{
    fingerprint: string;
    controller: AbortController;
  } | null>(null);
  const currentFingerprintRef = useRef('');
  const planningRevisionRef = useRef(0);
  // Mis-tap guards for the paid AI click. Page-scoped only: they cannot stop a
  // script that calls the cloud channel directly. See `llm-local-guard.ts`.
  const aiRequestGuardRef = useRef<LlmRequestGuard | null>(null);
  aiRequestGuardRef.current ??= createLlmRequestGuard();
  const aiRequestGuard = aiRequestGuardRef.current;
  // Same scope as the guard: one page instance, gone on reload. Holds only what
  // a model call produced, so a repeat of an identical request is free.
  const interpretationCacheRef = useRef<InterpretationCache | null>(null);
  interpretationCacheRef.current ??= createInterpretationCache();
  const interpretationCache = interpretationCacheRef.current;

  useEffect(() => {
    let cancelled = false;
    const apply = (version: string) => {
      if (!cancelled) setRuntimeConfigVersion(version);
    };
    const unsubscribe = subscribeRuntimeConfig((state) => apply(state.version));
    const refresh = () => {
      void loadRuntimeConfig()
        .then((state) => {
          if (state) apply(state.version);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const poiById = new Map(POIS.map((poi) => [poi.id, poi]));
  const sourceFingerprint = useMemo(
    () => requestFingerprint(input, quick, poiPreferences),
    [input, poiPreferences, quick],
  );
  const proposalIsCurrent = isProposalCurrent(proposal, sourceFingerprint);
  const settingConflicts = proposalIsCurrent
    ? (proposal?.request.settingConflicts ?? [])
    : [];
  const hasDraft =
    input.trim().length > 0 ||
    JSON.stringify(quick) !== JSON.stringify(DEFAULT_QUICK) ||
    Object.values(poiPreferences).some((value) => value !== 'default');
  const activeDayIndex = result
    ? Math.min(Math.max(Number(activeDay) || 0, 0), result.days.length - 1)
    : 0;
  const replacementAudit = useMemo(() => {
    if (!result || !replacementTarget)
      return { checkedCount: 0, eligible: [], ineligible: [] };
    return auditReplacementOptions(
      result,
      replacementTarget.dayIndex,
      replacementTarget.stopIndex,
    );
  }, [replacementTarget, result]);

  const invalidatePendingInterpretation = useCallback(() => {
    const wasInterpreting = activeInterpretationRef.current !== null;
    activeInterpretationRef.current?.controller.abort();
    activeInterpretationRef.current = null;
    activeInterpretationRunRef.current += 1;
    planningRevisionRef.current += 1;
    setProposal(null);
    setIsGenerating(false);
    setPhase(phaseAfterSourceChange(result !== null));
    if (wasInterpreting)
      setStatus(
        result
          ? '条件已经修改，上一份行程仍然保留；你可以重新整理。'
          : '条件已经修改，可以重新整理。',
      );
  }, [result]);

  useEffect(() => {
    currentFingerprintRef.current = sourceFingerprint;
    planningRevisionRef.current += 1;
    const active = activeInterpretationRef.current;
    if (active && active.fingerprint !== sourceFingerprint) {
      active.controller.abort();
      activeInterpretationRunRef.current += 1;
      activeInterpretationRef.current = null;
      setProposal(null);
      setIsGenerating(false);
      setPhase(phaseAfterSourceChange(result !== null));
      setStatus(
        result
          ? '条件已经修改，上一份行程仍然保留；你可以重新整理。'
          : '条件已经修改，可以重新整理。',
      );
    }
  }, [result, sourceFingerprint]);

  useEffect(
    () => () => {
      activeInterpretationRef.current?.controller.abort();
      planningRevisionRef.current += 1;
    },
    [],
  );

  const prepareProposal = useCallback(
    async (
      requestText: string,
      quickOverride: QuickState = quick,
      preferenceOverride: Record<string, PoiCardPreference> = poiPreferences,
      interpretationMode: InterpretationMode = 'rules',
    ) => {
      const wantsModel = interpretationMode !== 'rules';
      // `'ai'` asks the model on every click; `'auto'` asks it only when the
      // rules gate says the free answer is not good enough.
      const cascade = interpretationMode === 'auto';

      // Everything below runs before a single byte is sent. These are mis-tap
      // guards for this page, not endpoint protection — the published key is
      // readable from the bundle and the channel answers a script with no
      // Origin, so they cannot stop anything deliberate.
      //
      // Order is the contract (length → in-flight → cache → free rules pass →
      // gate → single-flight slot); `planRulesFirstClick` owns the first three
      // steps so they stay testable, and the slot is taken only after every
      // early return, so a rejected click cannot strand it.
      const quickSnapshot = structuredClone(quickOverride);
      const preferenceSnapshot = structuredClone(preferenceOverride);
      const fingerprint = requestFingerprint(
        requestText,
        quickSnapshot,
        preferenceSnapshot,
      );
      const plan = planRulesFirstClick({
        rawText: requestText,
        wantsModel,
        // Read from the state this click arrived in, before anything aborts it.
        alreadyRunning: activeInterpretationRef.current !== null,
        cached: wantsModel ? interpretationCache.get(fingerprint) : null,
      });

      if (plan.kind === 'input_too_long') {
        setError(plan.message);
        setClarificationNeeded(false);
        setPhase('error');
        setStatus(plan.message);
        return {
          ok: false as const,
          reason: plan.message,
          kind: 'scope' as const,
        };
      }

      if (plan.kind === 'already_running') {
        setStatus(plan.message);
        return {
          ok: false as const,
          reason: '已有理解请求正在进行。',
          kind: 'busy' as const,
        };
      }

      const reused = plan.kind === 'answer_from_cache' ? plan.outcome : null;

      // The free tier. Calling `interpretTripRequest` without an adapter is the
      // deterministic parser, which keeps one source of truth for that path.
      const rulesOutcome: InterpretationOutcome =
        reused ??
        (await interpretTripRequest({
          rawText: requestText,
          sourceFingerprint: fingerprint,
          adapter: undefined,
        }));

      let aiRelease: ((now?: number) => void) | null = null;
      let aiDowngraded = false;
      let downgradeNotice: string | null = null;
      let useModel = false;

      if (!reused && wantsModel && rulesOutcome.status === 'complete') {
        // `'auto'` only escalates when the free answer is not good enough; that
        // decision is the whole point of the cascade. `'ai'` always escalates.
        const escalate =
          !cascade || assessRulesTier(rulesOutcome.request).verdict === 'model';
        if (escalate) {
          // `alreadyRunning: false` because the page-level check already ran in
          // `planRulesFirstClick`; what is still worth asking here is the
          // guard's own single-flight and cooldown state.
          const escalation = planAiClick({
            rawText: requestText,
            alreadyRunning: false,
            guard: aiRequestGuard,
          });
          if (escalation.kind !== 'proceed') {
            if (escalation.kind === 'already_running') {
              setStatus(escalation.message);
              return {
                ok: false as const,
                reason: '已有理解请求正在进行。',
                kind: 'busy' as const,
              };
            }
            // `input_too_long` cannot happen here — step 1 ran the same check.
            // Treat it as "no model call" and answer from the rules result.
            aiDowngraded = true;
            downgradeNotice = escalation.message;
          } else if (escalation.modelAllowed) {
            aiRelease = escalation.release;
            useModel = true;
          } else {
            // Cooldown. The free answer is already computed, so this click is
            // neither a dead end nor a spend.
            aiDowngraded = true;
            downgradeNotice = escalation.notice;
          }
        }
      }

      currentFingerprintRef.current = fingerprint;
      activeInterpretationRef.current?.controller.abort();
      planningRevisionRef.current += 1;
      setIsGenerating(false);
      const controller = new AbortController();
      const runId = activeInterpretationRunRef.current + 1;
      activeInterpretationRunRef.current = runId;
      activeInterpretationRef.current = { fingerprint, controller };
      setPhase('interpreting');
      setStatus('正在理解你的描述…');

      // The cloud model path runs only on an explicit click that the guard let
      // through, and only when this build has no external parse service
      // configured.
      const aiParseEndpoint = useModel
        ? aiParseEndpointForExplicitClick({
            origin: typeof window === 'undefined' ? '' : window.location.origin,
            explicitUserClick: true,
          })
        : null;
      let cloudAdapter: ReturnType<typeof resolveCloudLlmDraftAdapter> = null;
      if (useModel && !aiParseEndpoint) {
        try {
          cloudAdapter = resolveCloudLlmDraftAdapter();
        } catch {
          // Building the SDK client failed. Hand the single-flight slot back
          // immediately (release is idempotent, so the settle path is a no-op
          // second call) and answer with the rules result already in hand
          // rather than stranding the click behind a slot that never frees.
          cloudAdapter = null;
          aiRelease?.();
          aiRelease = null;
          aiDowngraded = true;
          downgradeNotice = '云端理解服务初始化失败，本次已改用基础理解。';
        }
      }

      // A null `modelCall` means there is nothing to escalate to: either the
      // rules verdict was already good enough, the cooldown held the click back,
      // or the SDK client could not be built. All three publish `rulesOutcome`.
      const modelCall: Promise<InterpretationOutcome> | null = !useModel
        ? null
        : aiParseEndpoint
          ? interpretTripRequestViaBff({
              endpoint: aiParseEndpoint,
              rawText: requestText,
              sourceFingerprint: fingerprint,
              signal: controller.signal,
            })
          : cloudAdapter
            ? interpretTripRequest({
                rawText: requestText,
                sourceFingerprint: fingerprint,
                adapter: cloudAdapter,
                deadlineMs: CLOUD_LLM_DEADLINE_MS,
                signal: controller.signal,
              })
            : null;
      const interpretation: Promise<InterpretationOutcome> =
        modelCall ?? Promise.resolve(rulesOutcome);

      return interpretation.then((outcome) => {
        const isCurrent = canCommitInterpretation({
          runId,
          activeRunId: activeInterpretationRunRef.current,
          aborted: controller.signal.aborted,
          outcomeFingerprint: outcome.sourceFingerprint,
          currentFingerprint: currentFingerprintRef.current,
        });
        if (!isCurrent || outcome.status === 'aborted')
          return { ok: false as const, reason: '输入已更新。', kind: 'stale' };
        activeInterpretationRef.current = null;
        // Keep what the model produced so an identical request is served from
        // memory next time. `set` refuses rules-only runs (free to repeat) and
        // transport failures (worth retrying).
        if (wantsModel && outcome !== reused)
          interpretationCache.set(fingerprint, outcome);
        if (outcome.status === 'failed') {
          setError(outcome.message);
          setPhase('error');
          setStatus('这次理解没有完成；上一份成功行程仍然保留。');
          return {
            ok: false as const,
            reason: outcome.message,
            kind: 'service',
          };
        }

        const request = composeRequestFromParsed(
          outcome.request,
          quickSnapshot,
          preferenceSnapshot,
        );
        const nextProposal = buildPlanProposal(
          request,
          fingerprint,
          outcome.diagnostics,
          outcome.fieldEvidence,
        );
        setProposal(nextProposal);

        if (request.errors.length > 0) {
          setError(request.errors[0]);
          setClarificationNeeded(false);
          setPhase('error');
          setStatus('这次理解没有通过检查；上一份成功行程仍然保留。');
          return {
            ok: false as const,
            reason: request.errors[0],
            kind: 'scope',
          };
        }
        if (request.days === null) {
          setError(null);
          setClarificationNeeded(true);
          setPhase('needs_clarification');
          setStatus('我先保留已经理解的条件，只补问一个必要问题。');
          return {
            ok: false as const,
            reason: '需要补充 1–3 天。',
            kind: 'clarification',
          };
        }

        setClarificationNeeded(false);
        setError(null);
        setPhase('awaiting_confirmation');
        setStatus(
          aiDowngraded ||
            (outcome.diagnostics.acceptedMode === 'rules' &&
              outcome.diagnostics.attemptedMode === 'llm')
            ? (downgradeNotice ?? 'AI 理解暂不可用，已使用基础理解；请核对后继续。')
            : '请核对我的理解；确认后才会生成或更新行程。',
        );
        return {
          ok: true as const,
          proposalId: nextProposal.id,
          requiresConfirmation: true,
        };
      })
        .finally(() => {
          // Start the cooldown when the request settles, not when it starts, so
          // an aborted run still counts as the one spend it was. The guard keeps
          // the cooldown itself; there is no separate countdown state to update.
          // Idempotent, and null on every path that never took the slot.
          aiRelease?.();
        });
    },
    [aiRequestGuard, interpretationCache, poiPreferences, quick],
  );

  // Rules first, model only when the rules answer is not good enough
  // (`interpretation-tier.ts`), and a repeat of an identical request is served
  // from memory. Still fully user-initiated — the model runs only because of
  // this click or the ⌘/Ctrl+Enter shortcut, never on its own.
  // `defaultInterpretationModeForUserAction` keeps a build with no AI channel on
  // the rules path so a misconfigured deploy cannot leave a dead button.
  const handleInterpret = useCallback(() => {
    void prepareProposal(
      input,
      quick,
      poiPreferences,
      defaultInterpretationModeForUserAction({
        origin: typeof window === 'undefined' ? '' : window.location.origin,
        cloudLlmConfigured: isCloudLlmParseConfigured(),
      }),
    );
  }, [input, poiPreferences, prepareProposal, quick]);

  const focusTripDescription = () => {
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openDetailedSettings = (target: SettingConflictField | null = null) => {
    setSettingsFocusTarget(target);
    setSettingsOpen(true);
  };

  const mustCount = Object.values(poiPreferences).filter(
    (value) => value === 'must',
  ).length;
  const avoidCount = Object.values(poiPreferences).filter(
    (value) => value === 'avoid',
  ).length;

  const handlePoiPreference = (
    poiId: string,
    value: PoiCardPreference,
  ) => {
    invalidatePendingInterpretation();
    setPoiPreferences((items) => ({ ...items, [poiId]: value }));
    setError(null);
    setStatus(
      value === 'default'
        ? `已清除 ${poiById.get(poiId)?.nameZh ?? '该地点'} 的固定选择。`
        : `已将 ${poiById.get(poiId)?.nameZh ?? '该地点'} 设为${value === 'must' ? '必去' : '避开'}。`,
    );
  };

  const clearPoiPreferences = () => {
    invalidatePendingInterpretation();
    setPoiPreferences({});
    setError(null);
    setStatus('已清空必去和避开的选择。');
  };

  const goToDiscover = () => {
    setTripOpen(false);
    document.getElementById('discover')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const handleTripPlan = () => {
    setTripOpen(false);
    focusTripDescription();
  };

  const handleConfirmPlan = useCallback(() => {
    if (!proposal || !proposalIsCurrent) {
      setError('条件已经修改，请先让我重新理解，再确认生成。');
      setPhase('error');
      return;
    }
    setIsGenerating(true);
    setPhase('planning');
    setError(null);
    const planningRevision = planningRevisionRef.current + 1;
    planningRevisionRef.current = planningRevision;
    window.setTimeout(() => {
      if (
        !canCommitPlanning({
          revision: planningRevision,
          activeRevision: planningRevisionRef.current,
          proposalFingerprint: proposal.createdFrom,
          currentFingerprint: currentFingerprintRef.current,
        })
      )
        return;
      const outcome = planTrip(proposal.request);
      if (!outcome.ok) {
        setError(outcome.message);
        setClarificationNeeded(outcome.kind === 'clarification');
        setPhase(
          outcome.kind === 'clarification' ? 'needs_clarification' : 'error',
        );
        setStatus('新条件没有生成成功；上一份行程与撤销历史均未改变。');
        setIsGenerating(false);
        return;
      }

      setResult(outcome.result);
      setActiveDay('0');
      setHistory([]);
      setClarificationNeeded(false);
      setError(null);
      setPhase('plan_ready');
      setStatus(
        `已按确认条件生成 ${outcome.result.days.length} 天行程。你可以继续用一句话修改。`,
      );
      setIsGenerating(false);
      window.requestAnimationFrame(() => {
        overviewRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        });
      });
    }, 160);
  }, [proposal, proposalIsCurrent]);

  const handleClarifiedDays = (days: number) => {
    const nextQuick = { ...quick, days };
    setQuick(nextQuick);
    void prepareProposal(input, nextQuick);
  };

  const handlePromptStarter = (text: string) => {
    invalidatePendingInterpretation();
    setInput(text);
    setClarificationNeeded(false);
    setError(null);
    setPhase(result ? 'plan_ready' : 'idle');
    setStatus('示例已放入输入框，你可以先修改，再让我理解。');
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(text.length, text.length);
    });
  };

  const handleReplace = (dayIndex: number, stopIndex: number) => {
    setSelectedReplacementId('');
    setReplacementTarget({ dayIndex, stopIndex });
    setError(null);
  };

  const handleConfirmReplacement = () => {
    if (!result || !replacementTarget || !selectedReplacementId) return;
    const outcome = replaceStopWithPoi(
      result,
      replacementTarget.dayIndex,
      replacementTarget.stopIndex,
      selectedReplacementId,
    );
    if (!outcome.ok) {
      setError(outcome.message);
      setStatus('替换未提交；原行程和撤销历史保持不变。');
      return;
    }

    const snapshot: Snapshot = { result, activeDay };
    setHistory((items) => [...items.slice(-19), snapshot]);
    setResult(outcome.result);
    setActiveDay(String(replacementTarget.dayIndex));
    setReplacementTarget(null);
    setSelectedReplacementId('');
    setError(null);
    setStatus(outcome.message);
  };

  const handleUndo = () => {
    const snapshot = history.at(-1);
    if (!snapshot) return;
    setResult(snapshot.result);
    setActiveDay(snapshot.activeDay);
    setHistory((items) => items.slice(0, -1));
    setError(null);
    setStatus('已精确恢复到上一次替换前的行程。');
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const registration = context.registerTool(
      {
        name: 'generate_melbourne_itinerary',
        title: '准备墨尔本行程',
        description:
          '理解 1–3 天 Melbourne 旅行需求并在页面中显示待确认方案；用户确认后才生成行程。',
        inputSchema: {
          type: 'object',
          properties: {
            request: {
              type: 'string',
              minLength: 1,
              description: '包含明确天数的中文旅行需求。',
            },
          },
          required: ['request'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(inputValue) {
          const candidate = inputValue as { request?: unknown };
          if (
            typeof candidate?.request !== 'string' ||
            candidate.request.trim().length === 0
          ) {
            throw new Error('request 必须是非空字符串。');
          }
          setInput(candidate.request);
          return prepareProposal(candidate.request);
        },
      },
      { signal: lifecycle.signal },
    );
    void Promise.resolve(registration).catch(() => undefined);
    return () => lifecycle.abort();
  }, [prepareProposal]);

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      data-config-version={runtimeConfigVersion}
      id="top"
    >
      <SiteNav
        avoidCount={avoidCount}
        configVersion={runtimeConfigLabel(runtimeConfigVersion)}
        mustCount={mustCount}
        onOpenTrip={() => setTripOpen(true)}
        onStartPlanning={handleTripPlan}
      />

      <section
        className="relative overflow-hidden border-b border-slate-200/70 bg-[#f8f7f3]"
        id="plan"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgb(204_251_241/55%),transparent_34rem),radial-gradient(circle_at_88%_10%,rgb(219_234_254/70%),transparent_30rem)]"
        />
        <div className="relative mx-auto grid max-w-[1200px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:items-start lg:px-8 lg:py-12">
          <div className="pt-1 lg:sticky lg:top-24">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[11px] font-bold tracking-[0.16em] text-teal-800">
                MELBOURNE UNCOVERED · 2026
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600">
                {proposalIsCurrent &&
                proposal?.diagnostics.acceptedMode === 'llm'
                  ? 'AI 辅助理解 · 需要你确认'
                  : '规则优先 · 确定性规划'}
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-[3.35rem]">
              把一句中文，
              <br />
              <span className="text-blue-700">变成能出发的墨尔本行程。</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
              先说你想怎么逛：几天、和谁、住哪、喜欢什么、哪些非去不可。
              系统会先把理解结果和来源逐项摊开，等你确认后，再由确定性规划器排出
              1–3 天的行程、费用和换点方案。
            </p>

            <div className="mt-6 grid max-w-lg grid-cols-3 gap-2">
              {[
                ['40', '个有来源地点'],
                ['30', '题固定评测'],
                ['1–3', '天可执行行程'],
              ].map(([value, label]) => (
                <div
                  className="rounded-2xl border border-slate-200 bg-white/75 px-3 py-3 shadow-sm"
                  key={label}
                >
                  <p className="text-xl font-bold tracking-tight text-slate-950">
                    {value}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button
                className="h-10 bg-slate-950 px-4 text-white hover:bg-slate-800"
                onClick={focusTripDescription}
              >
                <Sparkles aria-hidden="true" />
                开始规划
              </Button>
              <a
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white/70 px-4 text-sm font-semibold text-slate-700 transition hover:bg-white hover:text-slate-950"
                href="#about"
              >
                看它怎么工作
              </a>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-sm">
              <div className="relative h-32 sm:h-36">
                <Image
                  alt="墨尔本城市天际线"
                  className="object-cover"
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 480px"
                  src="/melbourne-skyline.webp"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 to-transparent" />
                <p className="absolute bottom-2 left-3 text-xs font-semibold text-white">
                  CBD · Southbank · Carlton · East Melbourne
                </p>
              </div>
              <p className="px-3 py-2 text-[11px] leading-5 text-slate-500">
                地点来自 City of Melbourne Open Data；照片来自 Wikimedia
                Commons，保留作者与许可。没有实时房价、天气或余票。
              </p>
            </div>
          </div>

          <section className="overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-[0_18px_50px_rgb(15_23_42/10%)]">
          <div className="border-b border-blue-100 bg-gradient-to-r from-blue-50 via-white to-cyan-50 px-4 py-2.5 sm:px-5">
            <div className="flex items-start gap-2.5 sm:items-center">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-sm">
                <Bot aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">想怎么逛墨尔本？</p>
                <p className="mt-0.5 text-sm leading-5 text-slate-600 sm:truncate">
                  有什么旅行偏好？行程天数（1–3
                  天）、同行人数和住宿区域，也可以一起写下来。
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 sm:p-4">
            <label className="sr-only" htmlFor="trip-request">
              旅行需求
            </label>
            <Textarea
              ref={inputRef}
              id="trip-request"
              className="min-h-24 resize-y rounded-xl border-blue-200 bg-white p-3 text-base leading-6 shadow-inner focus-visible:ring-blue-300 sm:min-h-20 md:text-base"
              maxLength={LLM_LOCAL_LIMITS.maxInputChars}
              onChange={(event) => {
                invalidatePendingInterpretation();
                setInput(event.target.value);
                setError(null);
                setClarificationNeeded(false);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter')
                  handleInterpret();
              }}
              placeholder="例如：墨尔本玩 3 天，住 CBD，每天 11 点出门，喜欢户外和历史，行程别太赶"
              value={input}
            />

            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Badge
                  className="bg-blue-50 text-blue-800 sm:hidden"
                  variant="secondary"
                >
                  {proposalIsCurrent &&
                  proposal?.diagnostics.acceptedMode === 'llm'
                    ? 'AI 辅助理解 · 待你确认'
                    : '基础理解模式'}
                </Badge>
                <span>⌘/Ctrl + Enter 发送</span>
                {input.length >= LLM_LOCAL_LIMITS.maxInputChars - 400 ? (
                  <span className="font-medium text-amber-700">
                    {`已用 ${input.length} / ${LLM_LOCAL_LIMITS.maxInputChars} 字符`}
                  </span>
                ) : null}
                {result && !proposalIsCurrent ? (
                  <span className="font-medium text-amber-700">
                    新条件尚未应用
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <AdvancedSettingsSheet
                  conflictFields={settingConflicts.map((item) => item.field)}
                  focusTarget={settingsFocusTarget}
                  onChange={setQuick}
                  onDraftChange={() => {
                    invalidatePendingInterpretation();
                    setError(null);
                    setClarificationNeeded(false);
                  }}
                  onOpenChange={(open) => {
                    setSettingsOpen(open);
                    if (!open) setSettingsFocusTarget(null);
                  }}
                  open={settingsOpen}
                  quick={quick}
                />
                <Button
                  className="h-10 flex-1 bg-primary px-5 text-base shadow-sm hover:bg-blue-800 sm:flex-none"
                  disabled={phase === 'interpreting' || phase === 'planning'}
                  onClick={handleInterpret}
                >
                  <Send aria-hidden="true" />
                  {phase === 'interpreting'
                    ? '正在理解…'
                    : proposal && !proposalIsCurrent
                      ? '重新整理'
                      : '整理我的需求'}
                </Button>
              </div>
            </div>

            <div className="mt-2 flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              <p className="shrink-0 text-xs font-semibold text-slate-600">
                也许你想……
              </p>
              <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {PROMPT_STARTERS.map((starter) => (
                  <button
                    aria-label={`使用示例：${starter.request}`}
                    className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs leading-4 text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    key={starter.request}
                    onClick={() => handlePromptStarter(starter.request)}
                    title={starter.request}
                    type="button"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>

            {proposal &&
            proposalIsCurrent &&
            proposal.request.errors.length === 0 ? (
              <RequestProposalCard
                isGenerating={isGenerating}
                onConfirm={handleConfirmPlan}
                onEdit={() => openDetailedSettings()}
                phase={phase}
                proposal={proposal}
              />
            ) : hasDraft && (!proposal || !proposalIsCurrent) ? (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                发送后，我会先列出理解到的条件和默认值；你确认以后才生成行程。
              </p>
            ) : null}

            {clarificationNeeded ? (
              <output className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <span className="mr-2 font-medium text-amber-950">
                  计划在墨尔本玩几天？
                </span>
                {[1, 2, 3].map((days) => (
                  <Button
                    key={days}
                    onClick={() => handleClarifiedDays(days)}
                    size="sm"
                    variant="outline"
                  >
                    {days} 天
                  </Button>
                ))}
              </output>
            ) : null}
            {error ? (
              <div
                className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                role="alert"
              >
                <XCircle
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                {proposalIsCurrent && settingConflicts.length > 0 ? (
                  <div className="min-w-0 flex-1">
                    <strong>旅行描述和详细设置有不一致</strong>
                    <p className="mt-1 text-sm leading-5 text-red-800">
                      你可以直接修改上面的描述，也可以打开详细设置调整标出的项目。
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs text-red-800">
                      {settingConflicts.map((conflict, index) => (
                        <li
                          className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-2.5 py-2"
                          key={`${conflict.field}-${index}`}
                        >
                          <span>{conflict.message}</span>
                          <button
                            className="shrink-0 font-semibold text-red-900 underline underline-offset-2"
                            onClick={() => openDetailedSettings(conflict.field)}
                            type="button"
                          >
                            去修改
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="border-red-200 bg-white text-red-900 hover:bg-red-100"
                        onClick={focusTripDescription}
                        size="sm"
                        variant="outline"
                      >
                        <Pencil aria-hidden="true" />
                        修改旅行描述
                      </Button>
                      <Button
                        className="bg-red-700 text-white hover:bg-red-800"
                        onClick={() =>
                          openDetailedSettings(settingConflicts[0].field)
                        }
                        size="sm"
                      >
                        <SlidersHorizontal aria-hidden="true" />
                        查看冲突设置
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <strong>这次还不能继续：</strong>
                    {error}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          </section>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {!result ? (
          <>
            <FeaturedPois
              onPreferenceChange={handlePoiPreference}
              preferences={poiPreferences}
            />
            <output aria-live="polite" className="sr-only">
              {status}
            </output>
          </>
        ) : null}

        {result ? (
          <>
            <TripOverview
              historyCount={history.length}
              imageFailed={imageFailed}
              onImageError={() => setImageFailed(true)}
              onUndo={handleUndo}
              result={result}
              sectionRef={overviewRef}
              status={status}
            />

            <TripReadiness result={result} />

            <section aria-labelledby="daily-title" className="mt-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-blue-700">
                    逐日安排
                  </p>
                  <h2
                    className="mt-1 text-2xl font-bold tracking-tight text-slate-950"
                    id="daily-title"
                  >
                    按天查看完整行程
                  </h2>
                </div>
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Route aria-hidden="true" className="size-4" />
                  路程为坐标估算，不是导航路线
                </p>
              </div>

              <nav
                aria-label="选择要查看的日期"
                className="sticky top-0 z-20 -mx-2 mt-4 flex items-center gap-2 border-y border-slate-200/80 bg-background/95 px-2 py-2 backdrop-blur"
              >
                <Button
                  aria-label="查看上一天行程"
                  className="size-10 shrink-0 rounded-full bg-white shadow-sm"
                  disabled={activeDayIndex === 0}
                  onClick={() => setActiveDay(String(activeDayIndex - 1))}
                  size="icon-lg"
                  type="button"
                  variant="outline"
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </Button>

                <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5">
                  {result.days.map((day, index) => (
                    <button
                      aria-current={
                        activeDayIndex === index ? 'page' : undefined
                      }
                      aria-label={`查看第 ${day.day} 天行程`}
                      className={`min-w-24 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                        activeDayIndex === index
                          ? 'bg-primary text-white shadow-sm'
                          : 'bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-800'
                      }`}
                      key={day.day}
                      onClick={() => {
                        setActiveDay(String(index));
                      }}
                      type="button"
                    >
                      Day {day.day}
                    </button>
                  ))}
                </div>

                <span
                  aria-atomic="true"
                  aria-live="polite"
                  className="hidden shrink-0 text-xs font-semibold text-slate-500 sm:inline"
                >
                  第 {activeDayIndex + 1} / {result.days.length} 天
                </span>
                <Button
                  aria-label="查看下一天行程"
                  className="size-10 shrink-0 rounded-full bg-white shadow-sm"
                  disabled={activeDayIndex === result.days.length - 1}
                  onClick={() => setActiveDay(String(activeDayIndex + 1))}
                  size="icon-lg"
                  type="button"
                  variant="outline"
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </Button>
              </nav>

              <div className="mt-3">
                <DayWorkspace
                  day={result.days[activeDayIndex]}
                  dayIndex={activeDayIndex}
                  key={result.days[activeDayIndex].day}
                  onReplace={handleReplace}
                  poiById={poiById}
                  result={result}
                />
              </div>
            </section>

            <PlanningDetails result={result} />

            {history.length > 0 ? (
              <output
                aria-live="polite"
                className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl bg-slate-950 px-4 py-3 text-sm text-white shadow-2xl"
              >
                <span>{status}</span>
                <Button
                  className="shrink-0 bg-white text-slate-950 hover:bg-slate-100"
                  onClick={handleUndo}
                  size="sm"
                >
                  <Undo2 aria-hidden="true" />
                  撤销
                </Button>
              </output>
            ) : null}
          </>
        ) : null}

        <div className="mt-10 space-y-10">
          <DiscoverGrid
            onOpenTrip={() => setTripOpen(true)}
            onPlan={focusTripDescription}
            onPreferenceChange={handlePoiPreference}
            pois={POIS}
            preferences={poiPreferences}
          />

          <section className="scroll-mt-24" id="prepare">
            {result ? (
              <TripPreparation result={result} />
            ) : (
              <>
                <div className="max-w-2xl">
                  <p className="text-xs font-bold tracking-[0.22em] text-teal-700">
                    BEFORE YOU GO
                  </p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                    行前准备，等行程出来再具体说
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
                    先确认路线、日期和同行人，系统才会按实际情况给出交通、行李和购物提醒。没有依据的具体断言，这里不会假装有。
                  </p>
                </div>
                <div className="mt-5">
                  <PreparePreview />
                </div>
              </>
            )}
          </section>

          <ProjectEvidence />
          <SiteFooter />
        </div>

        <ReplacementDialog
          key={
            replacementTarget
              ? `${replacementTarget.dayIndex}-${replacementTarget.stopIndex}`
              : 'closed'
          }
          onConfirm={handleConfirmReplacement}
          onOpenChange={(open) => {
            if (!open) {
              setReplacementTarget(null);
              setSelectedReplacementId('');
            }
          }}
          onSelect={setSelectedReplacementId}
          open={Boolean(replacementTarget)}
          audit={replacementAudit}
          result={result}
          selectedId={selectedReplacementId}
          target={replacementTarget}
        />
      </div>

      <TripDrawer
        onClear={clearPoiPreferences}
        onDiscover={goToDiscover}
        onOpenChange={setTripOpen}
        onPlan={handleTripPlan}
        onRemove={(poiId) => handlePoiPreference(poiId, 'default')}
        open={tripOpen}
        pois={POIS}
        preferences={poiPreferences}
      />
    </main>
  );
}

function AdvancedSettingsSheet({
  conflictFields,
  focusTarget,
  onChange,
  onDraftChange,
  onOpenChange,
  open,
  quick,
}: {
  conflictFields: SettingConflictField[];
  focusTarget: SettingConflictField | null;
  onChange: React.Dispatch<React.SetStateAction<QuickState>>;
  onDraftChange: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  quick: QuickState;
}) {
  const set = <K extends keyof QuickState>(key: K, value: QuickState[K]) => {
    onChange((current) => ({
      ...current,
      [key]: value,
      partyTouched:
        current.partyTouched ||
        key === 'adults' ||
        key === 'concessions' ||
        key === 'childAgesText',
    }));
    onDraftChange();
  };
  const facetCounts = experienceFacetCounts();
  const conflictSet = new Set(conflictFields);

  useEffect(() => {
    if (!open || !focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(settingFieldDomId(focusTarget));
      const group = target?.closest('details');
      if (group instanceof HTMLDetailsElement) group.open = true;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const focusable = target?.querySelector<HTMLElement>(
        'input, select, button, [tabindex]:not([tabindex="-1"])',
      );
      window.requestAnimationFrame(() => (focusable ?? target)?.focus());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusTarget, open]);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetTrigger render={<Button className="h-11" variant="outline" />}>
        <SlidersHorizontal aria-hidden="true" />
        详细设置
      </SheetTrigger>
      <SheetContent
        className="w-[min(94vw,620px)] gap-0 sm:max-w-xl"
        side="right"
      >
        <SheetHeader className="border-b border-slate-200 pr-12">
          <SheetTitle className="text-lg font-bold">详细设置</SheetTitle>
          <SheetDescription>
            这里只补充或修改旅行条件；你的原始描述不会被自动改写。
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {conflictFields.length > 0 ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              红色标出的项目与旅行描述不一致，请选择要保留的设置。
            </div>
          ) : null}
          <details
            className="rounded-2xl border border-slate-200 bg-white"
            open
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 font-semibold text-slate-900">
              <CalendarDays
                aria-hidden="true"
                className="size-4 text-blue-700"
              />
              时间与范围
            </summary>
            <div className="grid gap-4 border-t border-slate-200 p-3">
              <SettingField
                conflicted={conflictSet.has('days')}
                fieldId="days"
                label="玩几天"
              >
                <div className="grid grid-cols-4 gap-1">
                  <ChoiceButton
                    active={quick.days === null}
                    onClick={() => set('days', null)}
                  >
                    未选
                  </ChoiceButton>
                  {[1, 2, 3].map((days) => (
                    <ChoiceButton
                      active={quick.days === days}
                      key={days}
                      onClick={() => set('days', days)}
                    >
                      {days} 天
                    </ChoiceButton>
                  ))}
                </div>
              </SettingField>
              <div className="grid gap-3 sm:grid-cols-2">
                <SettingField
                  conflicted={conflictSet.has('start_time')}
                  fieldId="start_time"
                  label="每天几点出发"
                >
                  <select
                    aria-label="每日出发时间"
                    className={selectClass}
                    onChange={(event) =>
                      set(
                        'startMinutes',
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                    value={quick.startMinutes ?? ''}
                  >
                    <option value="">未指定时按 09:30</option>
                    {Array.from(
                      { length: 21 },
                      (_, index) => 8 * 60 + index * 15,
                    ).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {formatTime(minutes)}
                      </option>
                    ))}
                  </select>
                </SettingField>
                <SettingField
                  conflicted={conflictSet.has('date')}
                  fieldId="date"
                  label="哪天出发（可不填）"
                >
                  <input
                    className={selectClass}
                    onChange={(event) => set('dateText', event.target.value)}
                    type="date"
                    value={quick.dateText}
                  />
                </SettingField>
              </div>
              <SettingField
                conflicted={conflictSet.has('origin')}
                fieldId="origin"
                label="每天从哪里出发"
              >
                <input
                  className={selectClass}
                  list="origin-options"
                  onChange={(event) => set('originText', event.target.value)}
                  placeholder="例如 CBD、Southbank 或当前地点库中的景点"
                  value={quick.originText}
                />
                <datalist id="origin-options">
                  {[
                    'CBD',
                    'Southbank',
                    'Docklands',
                    'Carlton',
                    'East Melbourne',
                  ].map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                  {POIS.flatMap((poi) => [
                    <option key={`${poi.id}-zh`} value={poi.nameZh}>
                      {poi.nameZh}
                    </option>,
                    <option key={`${poi.id}-en`} value={poi.nameEn}>
                      {poi.nameEn}
                    </option>,
                  ])}
                </datalist>
              </SettingField>
              <div className="flex flex-wrap gap-1.5" aria-label="常用起点">
                {['CBD', 'Southbank', 'Docklands', 'Carlton'].map((area) => (
                  <button
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-800"
                    key={area}
                    onClick={() => set('originText', area)}
                    type="button"
                  >
                    {area}
                  </button>
                ))}
              </div>
              <SettingField
                conflicted={conflictSet.has('area')}
                fieldId="area"
                label="主要活动区域"
              >
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ['cbd_core_v1', 'CBD 集中', '只安排 CBD 内地点'],
                      ['central_city_v1', '市中心优先', 'CBD 与邻近区域'],
                      [
                        'supported_inner_city',
                        '市区及内城',
                        '接受短途公共交通',
                      ],
                    ] as const
                  ).map(([value, label, detail]) => (
                    <button
                      aria-pressed={quick.geography === value}
                      className={`rounded-xl border p-2 text-left ${quick.geography === value ? 'border-blue-500 bg-blue-50 text-blue-950' : 'border-slate-200 hover:bg-slate-50'}`}
                      key={value}
                      onClick={() => set('geography', value)}
                      type="button"
                    >
                      <strong className="block text-sm">{label}</strong>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {detail}
                      </span>
                    </button>
                  ))}
                </div>
              </SettingField>
            </div>
          </details>

          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 font-semibold text-slate-900">
              <Users aria-hidden="true" className="size-4 text-blue-700" />
              同行人和预算
            </summary>
            <div className="grid gap-4 border-t border-slate-200 p-3">
              <SettingField
                conflicted={conflictSet.has('party')}
                fieldId="party"
                label="同行人数与票型"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumberStepper
                    label="成人"
                    onChange={(value) => set('adults', value)}
                    value={quick.adults}
                  />
                  <NumberStepper
                    label="优惠票人数"
                    onChange={(value) => set('concessions', value)}
                    value={quick.concessions}
                  />
                </div>
                <p className="text-xs text-slate-500">这里初始显示 1 位成人，仅作默认试算；改动人数后才会覆盖描述中的人数。</p>
              </SettingField>
              <SettingField label="儿童年龄">
                <input
                  className={selectClass}
                  onChange={(event) => set('childAgesText', event.target.value)}
                  placeholder="例如 5, 12"
                  value={quick.childAgesText}
                />
              </SettingField>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                <input
                  checked={quick.family}
                  onChange={(event) => set('family', event.target.checked)}
                  type="checkbox"
                />
                优先亲子友好地点
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-700">
                <input
                  checked={quick.lowWalking}
                  onChange={(event) => set('lowWalking', event.target.checked)}
                  type="checkbox"
                />
                尽量少走路
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <SettingField
                  conflicted={conflictSet.has('budget')}
                  fieldId="budget"
                  label="整趟预算（澳元，可不填）"
                >
                  <input
                    className={selectClass}
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => set('budgetText', event.target.value)}
                    placeholder="可选"
                    type="number"
                    value={quick.budgetText}
                  />
                </SettingField>
                <SettingField label="公共交通刷卡方式">
                  <select
                    className={selectClass}
                    onChange={(event) =>
                      set(
                        'paymentMedium',
                        event.target.value as QuickState['paymentMedium'],
                      )
                    }
                    value={quick.paymentMedium}
                  >
                    <option value="contactless">银行卡或手机感应支付</option>
                    <option value="existing_myki">自带 myki 卡</option>
                    <option value="new_physical_myki">需要购买 myki 卡</option>
                  </select>
                </SettingField>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SettingField label="住宿每晚（澳元，整团，可填范围）">
                  <input
                    className={selectClass}
                    onChange={(event) =>
                      set('lodgingPerNightText', event.target.value)
                    }
                    placeholder="如 100-150，可不填"
                    type="text"
                    value={quick.lodgingPerNightText}
                  />
                </SettingField>
                <SettingField label="住几晚">
                  <input
                    className={selectClass}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) =>
                      set('lodgingNightsText', event.target.value)
                    }
                    placeholder="可不填"
                    type="number"
                    value={quick.lodgingNightsText}
                  />
                </SettingField>
                <SettingField label="餐饮每人每天（澳元，可填范围）">
                  <input
                    className={selectClass}
                    onChange={(event) =>
                      set('foodPerDayText', event.target.value)
                    }
                    placeholder="如 30-50，可不填"
                    type="text"
                    value={quick.foodPerDayText}
                  />
                </SettingField>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                费用会按上面的人数估算。优惠票资格和儿童票适用年龄，请在购票前确认。
                住宿和餐饮是你自己的估算，只用来给出参考区间，不代表实际价格。
              </p>
            </div>
          </details>

          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 font-semibold text-slate-900">
              <MessageCircle
                aria-hidden="true"
                className="size-4 text-blue-700"
              />
              游玩偏好
            </summary>
            <div className="grid gap-5 border-t border-slate-200 p-3">
              <SettingField
                conflicted={conflictSet.has('pace')}
                fieldId="pace"
                label="一天想安排多满"
              >
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ['relaxed', '轻松', '2–3 站'],
                      ['balanced', '均衡', '3–4 站'],
                      ['packed', '紧凑', '约 4 站'],
                    ] as const
                  ).map(([value, label, detail]) => (
                    <button
                      aria-pressed={quick.pace === value}
                      className={`rounded-xl border px-2 py-2 text-center ${quick.pace === value ? 'border-blue-500 bg-blue-50 text-blue-950' : 'border-slate-200 hover:bg-slate-50'}`}
                      key={value}
                      onClick={() => set('pace', value)}
                      type="button"
                    >
                      <strong className="block text-sm">{label}</strong>
                      <span className="text-xs text-slate-500">{detail}</span>
                    </button>
                  ))}
                </div>
              </SettingField>
              <SettingField
                conflicted={conflictSet.has('venue')}
                fieldId="venue"
                label="更喜欢室内还是户外"
              >
                <div className="grid grid-cols-5 gap-1 rounded-2xl bg-slate-100 p-1">
                  {(
                    [
                      ['strong_indoor', '室内'],
                      ['indoor', '偏室内'],
                      ['neutral', '均衡'],
                      ['outdoor', '偏户外'],
                      ['strong_outdoor', '户外'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      aria-label={`场所环境：${label}`}
                      aria-pressed={quick.venuePreference === value}
                      className={`min-h-10 rounded-xl px-1 text-xs font-semibold ${quick.venuePreference === value ? 'bg-white text-blue-800 shadow-sm ring-1 ring-blue-200' : 'text-slate-600 hover:bg-white/70'}`}
                      key={value}
                      onClick={() => set('venuePreference', value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </SettingField>
              <div
                className={settingFieldClass(conflictSet.has('experiences'))}
                id={settingFieldDomId('experiences')}
                tabIndex={-1}
              >
                <p className="text-xs font-medium text-slate-600">想体验什么</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  以下分类是为了方便选择，由本项目根据地点资料整理，并非官方旅游分类。
                </p>
                <div className="mt-2 grid gap-2">
                  {EXPERIENCE_FACETS.map((facet) => {
                    const value = quick.experiences[facet.id];
                    const count = facetCounts[facet.id];
                    return (
                      <div
                        className="flex items-center gap-2 rounded-xl border border-slate-200 p-2"
                        key={facet.id}
                      >
                        <div className="min-w-0 flex-1">
                          <strong className="block text-sm text-slate-900">
                            {facet.label}
                          </strong>
                          <span className="block truncate text-xs text-slate-500">
                            {count}/40 个地点{count < 3 ? ' · 覆盖有限' : ''} ·{' '}
                            {facet.description}
                          </span>
                        </div>
                        <button
                          aria-pressed={value === 'prefer'}
                          className={`min-h-9 rounded-lg px-2 text-xs font-semibold ${value === 'prefer' ? 'bg-blue-700 text-white' : 'bg-blue-50 text-blue-800'}`}
                          onClick={() =>
                            updateExperience(
                              onChange,
                              onDraftChange,
                              facet.id,
                              value === 'prefer' ? 'neutral' : 'prefer',
                            )
                          }
                          type="button"
                        >
                          想看
                        </button>
                        <button
                          aria-pressed={value === 'avoid'}
                          className={`min-h-9 rounded-lg px-2 text-xs font-semibold ${value === 'avoid' ? 'bg-red-100 text-red-900 ring-1 ring-red-200' : 'bg-slate-100 text-slate-600'}`}
                          onClick={() =>
                            updateExperience(
                              onChange,
                              onDraftChange,
                              facet.id,
                              value === 'avoid' ? 'neutral' : 'avoid',
                            )
                          }
                          type="button"
                        >
                          少排
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>
        </div>
        <SheetFooter className="border-t border-slate-200 bg-white">
          <SheetClose render={<Button className="w-full" />}>
            保存设置
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function updateExperience(
  onChange: React.Dispatch<React.SetStateAction<QuickState>>,
  onDraftChange: () => void,
  facet: ExperienceFacet,
  value: PreferenceState,
) {
  onChange((current) => ({
    ...current,
    experiences: { ...current.experiences, [facet]: value },
  }));
  onDraftChange();
}

function NumberStepper({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="grid gap-1 text-xs font-medium text-slate-600">
      <span>{label}</span>
      <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-white">
        <button
          aria-label={`减少${label}`}
          className="h-full w-11 text-lg text-slate-600 hover:bg-slate-50"
          onClick={() => onChange(Math.max(0, value - 1))}
          type="button"
        >
          −
        </button>
        <output className="flex-1 text-center text-sm font-semibold text-slate-900">
          {value}
        </output>
        <button
          aria-label={`增加${label}`}
          className="h-full w-11 text-lg text-slate-600 hover:bg-slate-50"
          onClick={() => onChange(Math.min(10, value + 1))}
          type="button"
        >
          ＋
        </button>
      </div>
    </div>
  );
}

function SettingField({
  children,
  conflicted = false,
  fieldId,
  label,
}: {
  children: React.ReactNode;
  conflicted?: boolean;
  fieldId?: SettingConflictField;
  label: string;
}) {
  return (
    <div
      className={settingFieldClass(conflicted)}
      id={fieldId ? settingFieldDomId(fieldId) : undefined}
      tabIndex={fieldId ? -1 : undefined}
    >
      <span>{label}</span>
      {children}
    </div>
  );
}

function settingFieldDomId(field: SettingConflictField) {
  return `trip-setting-${field.replaceAll('_', '-')}`;
}

function settingFieldClass(conflicted: boolean) {
  return `grid scroll-mt-24 gap-1 text-xs font-medium text-slate-600 outline-none transition ${
    conflicted
      ? 'rounded-xl bg-red-50 p-2 ring-2 ring-red-300 focus:ring-red-500'
      : ''
  }`;
}

function ChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-9 rounded-md px-1 text-xs font-semibold transition ${active ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-blue-50'}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

const selectClass =
  'h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200';

function RequestProposalCard({
  isGenerating,
  onConfirm,
  onEdit,
  phase,
  proposal,
}: {
  isGenerating: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  phase: AgentSessionPhase;
  proposal: PlanProposal;
}) {
  const canConfirm =
    phase === 'awaiting_confirmation' && proposal.request.days !== null;
  const scopeIds = new Set(['days', 'origin', 'time', 'area']);
  const preferenceIds = new Set(['pace', 'venue', 'travelers']);
  const scopeItems = proposal.summary.filter((item) => scopeIds.has(item.id));
  const preferenceItems = proposal.summary.filter((item) =>
    preferenceIds.has(item.id),
  );
  const additionalItems = proposal.summary.filter(
    (item) => !scopeIds.has(item.id) && !preferenceIds.has(item.id),
  );
  return (
    <section
      className="mt-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-3 sm:p-4"
      aria-labelledby="proposal-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            className="flex items-center gap-2 font-semibold text-slate-950"
            id="proposal-title"
          >
            <Bot aria-hidden="true" className="size-4 text-blue-700" />
            也许你想……
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            我先整理成下面这些条件；每项都标出来源，确认后才会生成或更新行程。
          </p>
        </div>
        <Badge className="shrink-0 bg-white text-blue-800" variant="secondary">
          {phase === 'needs_clarification' ? '还差 1 项' : '待你确认'}
        </Badge>
      </div>
      <div className="mt-3 overflow-hidden rounded-xl bg-white ring-1 ring-blue-100">
        <ProposalGroup
          className="grid-cols-2 md:grid-cols-4"
          items={scopeItems}
          label="行程范围"
        />
        <ProposalGroup
          className="grid-cols-2 md:grid-cols-3"
          items={preferenceItems}
          itemClassName="last:col-span-2 md:last:col-span-1"
          label="偏好与同行"
        />
        {additionalItems.length > 0 ? (
          <ProposalGroup
            className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            items={additionalItems}
            label="其他偏好"
          />
        ) : null}
      </div>
      {proposal.request.warnings.length > 0 ? (
        <p className="mt-3 text-xs leading-5 text-amber-800">
          需要留意：{proposal.request.warnings.slice(0, 2).join('；')}
        </p>
      ) : null}
      {canConfirm ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-blue-100 pt-3 sm:flex-row sm:justify-end">
          <Button onClick={onEdit} variant="outline">
            <Pencil aria-hidden="true" />
            修改条件
          </Button>
          <Button
            aria-busy={isGenerating}
            className="bg-primary hover:bg-blue-800"
            disabled={isGenerating}
            onClick={onConfirm}
          >
            <Sparkles aria-hidden="true" />
            {isGenerating ? '规划中…' : '按这些生成行程'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ProposalGroup({
  className,
  itemClassName,
  items,
  label,
}: {
  className: string;
  itemClassName?: string;
  items: ProposalSummaryItem[];
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="border-b border-slate-100 px-3 py-2 last:border-b-0">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400">
        {label}
      </p>
      <dl className={`grid gap-x-4 gap-y-2 ${className}`}>
        {items.map((item) => (
          <ProposalItem className={itemClassName} item={item} key={item.id} />
        ))}
      </dl>
    </div>
  );
}

function ProposalItem({
  className,
  item,
}: {
  className?: string;
  item: ProposalSummaryItem;
}) {
  const source = {
    user: { label: '描述中提到', className: 'bg-blue-100 text-blue-800' },
    manual: { label: '详细设置', className: 'bg-violet-100 text-violet-800' },
    agent_default: {
      label: '暂用默认',
      className: 'bg-slate-200 text-slate-700',
    },
    needs_confirmation: {
      label: '需要补充',
      className: 'bg-amber-100 text-amber-900',
    },
  }[item.source];
  return (
    <div className={`min-w-0 py-0.5 ${className ?? ''}`}>
      <dt className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>{item.label}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${source.className}`}
          title={
            item.evidence
              ? `${item.source === 'user' ? '原始描述' : '设置依据'}：${item.evidence}`
              : `来源：${source.label}`
          }
        >
          {source.label}
        </span>
        <span className="sr-only">
          来源：{source.label}
          {item.evidence ? `；依据：${item.evidence}` : ''}
        </span>
      </dt>
      <dd className="mt-0.5 text-sm font-semibold leading-5 text-slate-950">
        {item.value}
      </dd>
    </div>
  );
}

function BudgetSummary({ result }: { result: PlannerResult }) {
  const budget = result.budget;
  if (budget.pricingParty.ticketBreakdownStatus !== 'complete') {
    const count = budget.pricingParty.totalTravelers;
    const hasChildWithoutAge = /(?:一大一小|1大1小|孩子|儿童)/i.test(
      result.request.rawText,
    ) && budget.pricingParty.childAges.length === 0;
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800">
        <p className="font-semibold">
          {count !== null ? `${count} 人同行 · ` : ''}票型待确认
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-700">
          {hasChildWithoutAge
            ? '孩子几岁？这会影响票价估算。'
            : count !== null
              ? `这 ${count} 位分别是成人，还是有儿童或优惠票旅客？`
              : '请确认同行人的票型。'}
          {' '}确认前暂不估算整团门票、公共交通费用，也不比较总预算。
        </p>
      </div>
    );
  }
  const comparison =
    budget.comparison === 'known_min_exceeds_limit'
      ? '目前能确认的费用已超过预算'
      : budget.comparison === 'known_components_within_limit'
        ? budget.coverage.unknownItems.length > 0
          ? '已知费用在预算内，仍有部分费用待确认'
          : '已知费用在预算内'
        : budget.totalLimitCents == null
          ? '还没有填写整趟预算'
          : '部分费用没有上限，出发前还要确认';
  const partySummary = [
    `${budget.pricingParty.adultFullFareCount} 位成人`,
    budget.pricingParty.concessionEligibleCount > 0
      ? `${budget.pricingParty.concessionEligibleCount} 位优惠票旅客`
      : null,
    budget.pricingParty.childAges.length > 0
      ? `${budget.pricingParty.childAges.length} 位儿童`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:grid-cols-3">
      <div>
        <p className="text-xs text-amber-800">景点门票（已核实部分）</p>
        <p className="font-bold text-slate-950">
          {moneyRange(budget.admissionRange)}
        </p>
      </div>
      <div>
        <p className="text-xs text-amber-800">公共交通最多预留</p>
        <p className="font-bold text-slate-950">
          {budget.transitRange.maxCents == null
            ? '需确认'
            : `A$${(budget.transitRange.maxCents / 100).toFixed(2)}`}
        </p>
        <p className="text-xs text-slate-600">
          {budget.mykiSetupRange.maxCents
            ? `另需购买 myki 卡 A$${(budget.mykiSetupRange.maxCents / 100).toFixed(2)}`
            : '无需另计购卡费'}
        </p>
      </div>
      <div>
        <p className="text-xs text-amber-800">和预算相比</p>
        <p className="font-semibold text-slate-950">{comparison}</p>
      </div>
      {budget.assumptionItems.length > 0 ? (
        <div className="sm:col-span-3 rounded-lg border border-amber-200 bg-white/70 p-2 text-xs leading-5 text-slate-700">
          <p className="font-semibold text-slate-900">按你填写的估算（不是实际价格）</p>
          {budget.assumptionItems.map((item) => (
            <p key={item.id}>
              {item.label}：{item.quantity}
              {' = '}
              {item.missing ? `暂算不出（${item.missing}）` : moneyRange(item)}
            </p>
          ))}
          <p className="mt-1 font-semibold text-slate-900">
            {budget.estimateRange
              ? `已核实费用 + 你的估算：${moneyRange(budget.estimateRange)}`
              : '已核实费用 + 你的估算：还缺数据，暂不合计'}
            {budget.estimateComparison === 'estimate_min_exceeds_limit'
              ? ' · 估算下限已超过预算'
              : budget.estimateComparison === 'estimate_within_limit'
                ? budget.coverage.unknownItems.length > 0
                  ? ' · 估算在预算内（不含下面待确认的项目）'
                  : ' · 估算在预算内（机场接送等未计入的项目除外）'
                : budget.estimateComparison === 'indeterminate'
                  ? ' · 是否超预算取决于待确认的项目'
                  : ''}
          </p>
        </div>
      ) : null}
      <p className="sm:col-span-3 text-xs leading-5 text-slate-600">
        按 {partySummary} 估算 · 交通按每日最高费用预留，并非逐段精确票价 · 待确认：
        {budget.coverage.unknownItems.join('、') || '无'} ·
        暂不包含机场接送和未选择的附加体验
        {budget.assumptionItems.length < 2
          ? ' · 住宿和餐饮可在详细设置里填写你的估算'
          : ''}
        {' '}· 优惠资格与实际票价请在购票前确认
      </p>
    </div>
  );
}

function ReplacementDialog({
  audit,
  onConfirm,
  onOpenChange,
  onSelect,
  open,
  result,
  selectedId,
  target,
}: {
  audit: ReturnType<typeof auditReplacementOptions>;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  open: boolean;
  result: PlannerResult | null;
  selectedId: string;
  target: ReplacementTarget | null;
}) {
  const [query, setQuery] = useState('');
  const currentId =
    target && result
      ? result.days[target.dayIndex]?.stops[target.stopIndex]?.poiId
      : null;
  const currentPoi = currentId
    ? POIS.find((poi) => poi.id === currentId)
    : null;
  const currentName = currentPoi?.nameZh;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (poi: Poi) =>
    !normalizedQuery ||
    [poi.nameZh, poi.nameEn, poi.area, categoryLabel(poi)]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  const eligible = audit.eligible.filter((option) => matchesQuery(option.poi));
  const ineligible = audit.ineligible.filter((option) =>
    matchesQuery(option.poi),
  );
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[88vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] p-4">
        <DialogHeader>
          <div className="flex items-start gap-3 text-left">
            {currentPoi ? (
              <PoiVisual
                className="h-16 w-20 shrink-0"
                compact
                poi={currentPoi}
                sizes="80px"
              />
            ) : null}
            <div className="min-w-0">
              <DialogTitle>替换「{currentName ?? '当前地点'}」</DialogTitle>
              <DialogDescription className="mt-1">
                已检查 {audit.checkedCount} 个地点 · 可直接替换{' '}
                {audit.eligible.length} · 暂不可选 {audit.ineligible.length}
                。点击确认前，行程不会改变。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <label className="sr-only" htmlFor="replacement-search">
            搜索替代地点
          </label>
          <input
            className={`${selectClass} mb-3`}
            id="replacement-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按地点、英文名、分类或区域搜索"
            type="search"
            value={query}
          />
          <fieldset>
            <legend className="mb-2 font-semibold text-slate-900">
              可直接替换（{eligible.length}
              {normalizedQuery ? ` / ${audit.eligible.length}` : ''}）
            </legend>
            {eligible.length === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {normalizedQuery
                  ? '没有匹配搜索的可行地点。'
                  : '暂无同时满足时间、范围和去重规则的候选；原行程不会改变。'}
              </p>
            ) : (
              <div className="grid gap-2">
                {eligible.map((option) => (
                  <label
                    aria-label={`选择 ${option.poi.nameZh} 作为替换地点`}
                    className={`cursor-pointer rounded-xl border p-3 ${selectedId === option.poi.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                    key={option.poi.id}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        checked={selectedId === option.poi.id}
                        className="mt-1"
                        name="replacement"
                        onChange={() => onSelect(option.poi.id)}
                        type="radio"
                      />
                      <PoiVisual
                        className="h-16 w-20 shrink-0"
                        compact
                        poi={option.poi}
                        sizes="80px"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <strong>{option.poi.nameZh}</strong>
                          <span className="text-sm text-slate-600">
                            {option.startTime}–{option.endTime}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {categoryLabel(option.poi)} · {option.poi.area} ·{' '}
                          {option.poi.suggestedMinutes} 分钟 · 当天{' '}
                          {option.dayFinishTime} 结束
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          当天地点间直线估算总计{' '}
                          {option.dayDistanceKm.toFixed(1)} km · 比当前
                          {option.distanceDeltaKm === 0
                            ? '不变'
                            : option.distanceDeltaKm > 0
                              ? `多 ${option.distanceDeltaKm.toFixed(1)} km`
                              : `少 ${Math.abs(option.distanceDeltaKm).toFixed(1)} km`}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          景点门票：{option.priceDisplay}
                        </p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
            <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold text-slate-800">
              查看暂不可选地点（{ineligible.length}
              {normalizedQuery ? ` / ${audit.ineligible.length}` : ''}）
            </summary>
            <ul className="divide-y divide-slate-200 border-t border-slate-200 px-3">
              {ineligible.length === 0 ? (
                <li className="py-3 text-sm text-slate-600">
                  没有匹配搜索的暂不可选地点。
                </li>
              ) : (
                ineligible.map((option) => (
                  <li
                    className="flex items-start gap-3 py-2.5"
                    key={option.poi.id}
                  >
                    <PoiVisual
                      className="h-14 w-16 shrink-0"
                      compact
                      poi={option.poi}
                      sizes="64px"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800">
                        {option.poi.nameZh}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {categoryLabel(option.poi)} · {option.poi.area} ·{' '}
                        {option.poi.nameEn}
                      </p>
                    </div>
                    <Badge
                      className="shrink-0 bg-slate-200 text-slate-700"
                      variant="secondary"
                    >
                      {option.reason}
                    </Badge>
                  </li>
                ))
              )}
            </ul>
          </details>
        </div>
        <DialogFooter className="mt-0">
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button disabled={!selectedId} onClick={onConfirm}>
            确认替换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function composeRequestFromParsed(
  parsedRequest: ParsedTripRequest,
  quick: QuickState,
  poiPreferences: Record<string, PoiCardPreference>,
) {
  const experiencePreferences = Object.fromEntries(
    Object.entries(quick.experiences).filter(
      ([, value]) => value !== 'neutral',
    ),
  ) as Partial<Record<ExperienceFacet, PreferenceState>>;
  const childTokens = quick.childAgesText.trim()
    ? quick.childAgesText.split(/[,，\s]+/).filter(Boolean)
    : [];
  const childAges = childTokens.map(Number);
  const budgetValue =
    quick.budgetText.trim() === '' ? null : Number(quick.budgetText);
  const settings: StructuredTripSettings = {
    days: quick.days,
    startMinutes: quick.startMinutes,
    originText: quick.originText || null,
    geography: quick.geography,
    venuePreference: quick.venuePreference,
    pace: quick.pace,
    experiencePreferences,
    lowWalking: quick.lowWalking ? true : null,
    family: quick.family || childAges.length > 0 ? true : null,
    dateText: quick.dateText || undefined,
    totalBudgetCents:
      quick.budgetText.trim() === ''
        ? undefined
        : budgetValue == null || Number.isNaN(budgetValue)
          ? null
          : Math.round(budgetValue * 100),
    pricingParty: quick.partyTouched
      ? {
          adultFullFareCount: quick.adults,
          concessionEligibleCount: quick.concessions,
          childAges: childAges.filter((age) => Number.isFinite(age)),
          ptvPaymentMedium: quick.paymentMedium,
        }
      : quick.paymentMedium !== 'contactless'
        ? { ptvPaymentMedium: quick.paymentMedium }
        : undefined,
  };
  const lodgingRange = parseAudRangeInput(quick.lodgingPerNightText);
  const foodRange = parseAudRangeInput(quick.foodPerDayText);
  const nightsText = quick.lodgingNightsText.trim();
  const nights = nightsText === '' ? null : Number(nightsText);
  const costAssumptions: NonNullable<StructuredTripSettings['costAssumptions']> = {};
  if (lodgingRange)
    costAssumptions.accommodation = {
      perNightMinCents: lodgingRange.min,
      perNightMaxCents: lodgingRange.max,
      nights:
        nights != null && Number.isInteger(nights) && nights >= 1 && nights <= 30
          ? nights
          : null,
      source: 'structured',
      evidence: null,
    };
  if (foodRange)
    costAssumptions.food = {
      perPersonPerDayMinCents: foodRange.min,
      perPersonPerDayMaxCents: foodRange.max,
      source: 'structured',
      evidence: null,
    };
  if (Object.keys(costAssumptions).length > 0)
    settings.costAssumptions = costAssumptions;
  let request = mergeStructuredTripRequest(parsedRequest, settings);
  if (lodgingRange === null || foodRange === null)
    request.errors.push('住宿或餐饮估算请填写澳元数字，例如 120 或 100-150。');
  if (nights != null && (!Number.isInteger(nights) || nights < 1 || nights > 30))
    request.errors.push('住宿晚数请填写 1–30 的整数。');
  if (
    quick.budgetText.trim() &&
    (!Number.isFinite(budgetValue) || (budgetValue ?? 0) < 0)
  )
    request.errors.push('旅行预算请输入不小于 0 的数字。');
  if (childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17))
    request.errors.push('儿童年龄请使用 0–17 的整数，并用逗号分隔。');
  if (
    !Number.isInteger(quick.adults) ||
    !Number.isInteger(quick.concessions) ||
    quick.adults < 0 ||
    quick.concessions < 0
  )
    request.errors.push('旅客人数须为不小于 0 的整数。');
  if (quick.partyTouched && quick.adults + quick.concessions + childAges.length === 0)
    request.errors.push('至少需要 1 位同行人。');
  const mustIds = Object.entries(poiPreferences)
    .filter(([, value]) => value === 'must')
    .map(([id]) => id);
  const avoidIds = Object.entries(poiPreferences)
    .filter(([, value]) => value === 'avoid')
    .map(([id]) => id);
  request = mergePoiPreferenceConstraints(request, mustIds, avoidIds);
  return request;
}

function requestFingerprint(
  input: string,
  quick: QuickState,
  poiPreferences: Record<string, PoiCardPreference>,
): string {
  return JSON.stringify({
    input,
    quick,
    poiPreferences: Object.entries(poiPreferences).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  });
}

function moneyRange(range: {
  minCents: number | null;
  maxCents: number | null;
}) {
  if (range.minCents == null) return '需确认';
  const min = `A$${(range.minCents / 100).toFixed(2)}`;
  if (range.maxCents == null) return `${min} 起，上限待确认`;
  if (range.minCents === range.maxCents) return min;
  return `${min}–A$${(range.maxCents / 100).toFixed(2)}`;
}

function runtimeConfigLabel(version: string): string {
  if (version === 'bundled') return '内置';
  const date = new Date(version);
  if (Number.isNaN(date.getTime())) return version;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function venueLabel(value: VenuePreference) {
  return {
    strong_indoor: '室内为主',
    indoor: '偏室内',
    neutral: '室内外均衡',
    outdoor: '偏户外',
    strong_outdoor: '户外为主',
  }[value];
}
function geographyLabel(value: GeoScope) {
  return value === 'central_city_v1'
    ? '市中心优先'
    : value === 'cbd_core_v1'
      ? '仅 CBD'
      : '市区及内城';
}

function TripOverview({
  historyCount,
  imageFailed,
  onImageError,
  onUndo,
  result,
  sectionRef,
  status,
}: {
  historyCount: number;
  imageFailed: boolean;
  onImageError: () => void;
  onUndo: () => void;
  result: PlannerResult;
  sectionRef: React.RefObject<HTMLElement | null>;
  status: string;
}) {
  return (
    <section
      className="mt-4 scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      ref={sectionRef}
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-700">行程概览</p>
              <h2 className="text-xl font-bold tracking-tight text-slate-950">
                这份计划将如何执行
              </h2>
              <p aria-live="polite" className="mt-1 text-sm text-slate-600">
                {status}
              </p>
            </div>
            <Button
              disabled={historyCount === 0}
              onClick={onUndo}
              size="sm"
              variant="outline"
            >
              <Undo2 aria-hidden="true" />
              撤销上次替换{historyCount > 0 ? ` (${historyCount})` : ''}
            </Button>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <OverviewFact label="目的地" value="墨尔本" />
            <OverviewFact
              label="行程长度"
              value={`${result.days.length} 天 · ${result.summary.totalPois} 个地点`}
            />
            <OverviewFact
              label="每日时间"
              value={`${formatTime(result.request.dailyWindow.startMinutes)}–${formatTime(result.request.dailyWindow.endMinutes)}`}
            />
            <OverviewFact
              label="地点间距离"
              value={`约 ${result.summary.totalDistanceKm.toFixed(1)} km`}
            />
            <OverviewFact
              label="活动区域"
              value={geographyLabel(result.request.geography.scope)}
            />
            <OverviewFact
              label="日期"
              value={result.request.dateText ?? '未指定'}
            />
          </dl>

          <p className="mt-3 flex items-start gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-950">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {result.request.origin.label} ·
              每天从这里离开，首段路程也计入时间与距离。
            </span>
          </p>

          <div
            className="mt-3 flex flex-wrap gap-2"
            aria-label="已识别的旅行偏好"
          >
            <Badge className="h-8 bg-blue-50 px-3 text-blue-800">
              <CalendarDays aria-hidden="true" />
              {interestSummary(result)}
            </Badge>
            <Badge className="h-8 bg-amber-50 px-3 text-amber-900">
              {preferenceSummary(result)}
            </Badge>
            {result.request.mustIncludePoiIds.length > 0 ? (
              <Badge className="h-8 bg-emerald-50 px-3 text-emerald-800">
                必去：{poiNames(result.request.mustIncludePoiIds)}
              </Badge>
            ) : null}
            {result.request.excludePoiIds.length > 0 ? (
              <Badge className="h-8 bg-slate-100 px-3 text-slate-700">
                已避开：{poiNames(result.request.excludePoiIds)}
              </Badge>
            ) : null}
          </div>

          <BudgetSummary result={result} />
        </div>

        <figure className="relative min-h-40 overflow-hidden bg-slate-100 md:min-h-full">
          {imageFailed ? (
            <div className="grid h-full min-h-40 place-items-center text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <ImageOff aria-hidden="true" className="size-4" />
                图片未加载，不影响行程
              </span>
            </div>
          ) : (
            <Image
              alt="从 Point Ormond 远望墨尔本城市天际线"
              className="size-full object-cover"
              fill
              onError={onImageError}
              sizes="(min-width: 768px) 260px, 100vw"
              src="/melbourne-skyline.webp"
            />
          )}
          <figcaption className="absolute inset-x-0 bottom-0 bg-slate-950/65 px-3 py-2 text-xs text-white backdrop-blur-sm">
            Melbourne skyline · 李沛钊 / Wikimedia Commons · CC BY-SA 4.0
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function OverviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function TripReadiness({ result }: { result: PlannerResult }) {
  const attention = result.checks.filter((item) => item.status !== 'pass');
  const needsAdjustment = attention.some((item) => item.status === 'fail');
  const dynamicLabels = attention
    .slice(0, 3)
    .map((item) => friendlyCheckLabel(item))
    .join('、');

  return (
    <section
      aria-labelledby="readiness-title"
      className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-sm ${
        needsAdjustment
          ? 'border-red-200 bg-red-50 text-red-950'
          : 'border-emerald-200 bg-emerald-50 text-emerald-950'
      }`}
    >
      {needsAdjustment ? (
        <XCircle aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
      )}
      <h2 className="font-semibold" id="readiness-title">
        {needsAdjustment ? '有偏好需要留意' : '结构检查通过'}
      </h2>
      <span aria-hidden="true">·</span>
      <span>
        {attention.length} 项出发前确认
        {dynamicLabels ? `：${dynamicLabels}` : ''}
      </span>
      <a
        className="ml-auto font-semibold text-blue-800 hover:underline"
        href="#planning-details"
      >
        查看完整检查
      </a>
    </section>
  );
}

function PlanningDetails({ result }: { result: PlannerResult }) {
  const configVersion = getRuntimeConfig().version;
  return (
    <details
      className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm"
      id="planning-details"
    >
      <summary
        aria-label="展开规划说明与数据来源"
        className="cursor-pointer list-none px-4 py-4 font-semibold text-slate-900 marker:hidden sm:px-5"
      >
        <span className="flex items-center justify-between gap-4">
          <span>
            规划说明与数据来源
            <span className="mt-1 block text-sm font-normal text-slate-500">
              查看估算方法、完整检查结果和地点数据来源
            </span>
          </span>
          <CircleHelp
            aria-hidden="true"
            className="size-5 shrink-0 text-blue-700"
          />
        </span>
      </summary>
      <div className="border-t border-slate-200 px-4 py-5 sm:px-5">
        <p className="text-sm leading-6 text-slate-600">
          行程由本地规则根据已核验地点生成。未知的营业时间、票价和实时交通不会被当作已经确认。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {result.checks.map((item) => (
            <ConstraintItem check={item} key={item.id} />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm text-slate-500">
          <a
            className="inline-flex items-center gap-1 font-medium text-blue-800 hover:underline"
            href={POI_DATASET.sourceDatasetUrl}
            rel="noreferrer"
            target="_blank"
          >
            {POI_DATASET.attribution} · {POI_DATASET.license}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
          <span>
            数据快照 {POI_DATASET.generatedAt} · {result.dataVersion} ·{' '}
            {result.plannerVersion} · 配置{' '}
            {runtimeConfigLabel(configVersion)}
          </span>
        </div>
      </div>
    </details>
  );
}

function DayWorkspace({
  day,
  dayIndex,
  onReplace,
  poiById,
  result,
}: {
  day: DayPlan;
  dayIndex: number;
  onReplace: (dayIndex: number, stopIndex: number) => void;
  poiById: Map<string, Poi>;
  result: PlannerResult;
}) {
  const [showMap, setShowMap] = useState(true);
  const mapPoints = calculateMapPoints(day, poiById);
  const mealAfterIndex = findMealPosition(day);

  return (
    <article
      aria-labelledby={`day-${day.day}-title`}
      className="scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      id={`day-${day.day}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 bg-primary px-4 py-2.5 text-primary-foreground">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-blue-100">Day {day.day}</p>
            <h3 className="text-lg font-bold" id={`day-${day.day}-title`}>
              {day.title}
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-blue-100">
            {day.departureTime} 从起点出发 · {day.finishTime} 结束 ·{' '}
            {day.stops.length} 个地点 · 地点间直线估算约{' '}
            {day.totalDistanceKm.toFixed(1)} km
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1.5 font-semibold text-white">
            <CheckCircle2 aria-hidden="true" className="size-3.5" />
            时间无冲突
          </span>
          <Button
            aria-expanded={showMap}
            className="min-h-10 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={() => setShowMap((value) => !value)}
            size="sm"
            variant="outline"
          >
            <MapPin aria-hidden="true" />
            {showMap ? '收起位置图' : '查看位置图'}
          </Button>
        </div>
      </header>

      {showMap ? (
        <div
          aria-label={`Day ${day.day} 地点位置示意`}
          className="relative h-64 overflow-hidden border-b border-slate-200 bg-map-grid sm:h-72"
        >
          <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white/90 p-2 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
            {[
              ['art_culture', '艺术', 'bg-violet-500'],
              ['history', '历史', 'bg-amber-500'],
              ['nature', '自然', 'bg-emerald-500'],
              ['city_landmark', '地标', 'bg-blue-500'],
              ['market_food', '市集', 'bg-rose-500'],
              ['family', '亲子', 'bg-cyan-500'],
            ].map(([category, label, dot]) => (
              <span className="inline-flex items-center gap-1" key={category}>
                <span className={`size-2 rounded-full ${dot}`} />
                {label}
              </span>
            ))}
          </div>
          <svg
            aria-hidden="true"
            className="absolute inset-0 size-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <polyline
              fill="none"
              points={mapPoints
                .map((point) => `${point.x},${point.y}`)
                .join(' ')}
              stroke="rgb(15 118 110 / 75%)"
              strokeDasharray="2.5 2"
              strokeLinecap="round"
              strokeWidth="0.8"
            />
          </svg>
          {mapPoints.map((point, index) => (
            <div
              className="absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-white text-sm font-bold text-white shadow-lg"
              key={point.id}
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                backgroundColor:
                  {
                    art_culture: '#7c3aed',
                    history: '#b45309',
                    nature: '#047857',
                    city_landmark: '#1d4ed8',
                    market_food: '#be123c',
                    family: '#0e7490',
                  }[poiById.get(point.id)?.category ?? 'city_landmark'] ??
                  '#0f766e',
              }}
              title={`${poiById.get(point.id)?.nameZh ?? point.id} · ${poiById.get(point.id) ? categoryLabel(poiById.get(point.id) as Poi) : ''}`}
            >
              {index + 1}
            </div>
          ))}
          <p className="absolute inset-x-4 bottom-3 rounded-lg bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm backdrop-blur">
            数字顺序与下方行程一致；这里只显示坐标位置，实际路线请使用地图或 PTV
            查询。
          </p>
        </div>
      ) : null}

      <ol className="divide-y divide-slate-100 px-4">
        {day.stops.map((stop, stopIndex) => {
          const poi = poiById.get(stop.poiId);
          if (!poi) return null;
          const photo = getPoiPhoto(poi.id);
          const isMustInclude =
            result.request.mustIncludePoiIds?.includes(poi.id) ?? false;
          return (
            <li
              className="py-2.5"
              key={`${day.day}-${stopIndex}-${stop.poiId}`}
            >
              <div className="grid gap-2.5 sm:grid-cols-[132px_112px_minmax(0,1fr)_auto]">
                <div className="text-sm text-slate-600">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Clock3
                      aria-hidden="true"
                      className="size-4 text-blue-700"
                    />
                    {stop.startTime}–{stop.endTime}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {stopIndex === 0 ? `从${day.originLabel} · ` : ''}
                    {stop.travelFromPrevious.mode === 'walk'
                      ? '步行'
                      : '公共交通'}{' '}
                    {stop.travelFromPrevious.minutes} 分
                    <br />
                    直线约 {stop.travelFromPrevious.distanceKm.toFixed(1)} km
                  </p>
                  {stop.travelFromPrevious.distanceKm <= 1.2 ? (
                    <Badge
                      className="mt-1 bg-teal-50 text-teal-800"
                      variant="secondary"
                    >
                      邻近
                    </Badge>
                  ) : null}
                </div>
                <PoiVisual
                  className="aspect-[4/3] w-28 self-start"
                  compact
                  poi={poi}
                  sizes="112px"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="text-base font-bold text-slate-950">
                      {poi.nameZh}
                    </h4>
                    {isMustInclude ? (
                      <Badge className="bg-emerald-600 px-2 text-white hover:bg-emerald-600">
                        <ShieldCheck aria-hidden="true" className="size-3" />
                        必去
                      </Badge>
                    ) : null}
                    {stop.reasonTags.map((tag) => (
                      <Badge
                        className="bg-blue-50 text-blue-800"
                        key={tag.code}
                        variant="secondary"
                      >
                        {tag.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {poi.nameEn}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-700">
                    {poi.summary}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {categoryLabel(poi)} · {indoorLabel(poi)} ·{' '}
                    {poi.suggestedMinutes} 分钟 · {poi.area} · 景点门票：
                    {getAdmissionPriceRecord(poi.id)?.displayText ?? '需确认'}
                  </p>
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer font-medium text-blue-800">
                      查看来源与核验
                    </summary>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
                      <a
                        className="inline-flex items-center gap-1 hover:underline"
                        href={poi.referenceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {referenceLabel(poi)}{' '}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                      <a
                        className="inline-flex items-center gap-1 hover:underline"
                        href={POI_DATASET.sourceDatasetUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        坐标来源{' '}
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                      <span>
                        {poi.referenceStatus === 'verified'
                          ? `参考页已核验 ${poi.referenceVerifiedAt}`
                          : '参考页待复核'}
                      </span>
                      <span>
                        官方原始分类：{poi.sourceTheme} / {poi.sourceSubTheme}
                      </span>
                      <span>游玩分类由本项目整理</span>
                      {photo ? (
                        <a
                          className="inline-flex items-center gap-1 hover:underline"
                          href={photo.sourcePageUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          照片：{photo.author} · {photo.license}
                          <ExternalLink aria-hidden="true" className="size-3" />
                        </a>
                      ) : (
                        <span>暂无已核验实景图，当前显示地点示意</span>
                      )}
                    </div>
                  </details>
                </div>
                {isMustInclude ? null : (
                  <Button
                    aria-label={`查看${poi.nameZh}的替代地点`}
                    className="min-h-11 self-start"
                    onClick={() => onReplace(dayIndex, stopIndex)}
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw aria-hidden="true" />
                    查看替代地点
                  </Button>
                )}
              </div>
              {mealAfterIndex === stopIndex ? (
                <div className="mt-2 grid gap-1 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 sm:grid-cols-[138px_minmax(0,1fr)]">
                  <strong>
                    {day.mealBreak.startTime}–{day.mealBreak.endTime}
                  </strong>
                  <span>{day.mealBreak.label}</span>
                </div>
              ) : null}
            </li>
          );
        })}
        {mealAfterIndex === -1 ? (
          <li className="py-2.5">
            <div className="grid gap-1 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 sm:grid-cols-[138px_minmax(0,1fr)]">
              <strong>
                {day.mealBreak.startTime}–{day.mealBreak.endTime}
              </strong>
              <span>{day.mealBreak.label}</span>
            </div>
          </li>
        ) : null}
      </ol>
    </article>
  );
}

function ConstraintItem({ check }: { check: ConstraintCheck }) {
  const { status } = check;
  const styles = {
    pass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    fail: 'border-red-200 bg-red-50 text-red-950',
    not_verifiable: 'border-amber-200 bg-amber-50 text-amber-950',
  }[status];
  const Icon =
    status === 'pass' ? CheckCircle2 : status === 'fail' ? XCircle : CircleHelp;
  const statusText =
    status === 'pass'
      ? '已安排好'
      : status === 'fail'
        ? check.hard
          ? '需要调整'
          : '与偏好有差距'
        : '出发前确认';
  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <div className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden="true" className="size-4" />
        {statusText} · {friendlyCheckLabel(check)}
      </div>
      <p className="mt-1.5 text-sm leading-5 opacity-80">
        {friendlyCheckDetail(check)}
      </p>
    </div>
  );
}

function calculateMapPoints(day: DayPlan, poiById: Map<string, Poi>) {
  const pois = day.stops
    .map((stop) => poiById.get(stop.poiId))
    .filter((poi): poi is Poi => Boolean(poi));
  const minLon = Math.min(...pois.map((poi) => poi.longitude));
  const maxLon = Math.max(...pois.map((poi) => poi.longitude));
  const minLat = Math.min(...pois.map((poi) => poi.latitude));
  const maxLat = Math.max(...pois.map((poi) => poi.latitude));
  const lonSpan = maxLon - minLon || 0.01;
  const latSpan = maxLat - minLat || 0.01;
  return pois.map((poi, index) => ({
    id: poi.id,
    x: 20 + ((poi.longitude - minLon) / lonSpan) * 60,
    y:
      18 +
      ((maxLat - poi.latitude) / latSpan) * 52 +
      (pois.length === 1 ? index * 4 : 0),
  }));
}

function findMealPosition(day: DayPlan): number {
  for (let index = 0; index < day.stops.length; index += 1) {
    const current = day.stops[index];
    const next = day.stops[index + 1];
    if (
      current.endMinutes <= day.mealBreak.startMinutes &&
      (!next || next.startMinutes >= day.mealBreak.endMinutes)
    )
      return index;
  }
  return -1;
}

function categoryLabel(poi: Poi): string {
  return {
    art_culture: '艺术与文化',
    history: '历史与遗产',
    nature: '公园与花园',
    city_landmark: '城市地标与观景',
    market_food: '市集与本地生活',
    family: '亲子活动',
  }[poi.category];
}

function indoorLabel(poi: Poi): string {
  return {
    indoor: '室内',
    outdoor: '户外',
    mixed: '室内外混合',
    conditional: '室内参观待确认',
    unknown: '室内外属性待核实',
  }[poi.indoorOutdoor];
}

function referenceLabel(poi: Poi): string {
  if (poi.referenceStatus === 'unverified') return '待复核参考页';
  return {
    venue_official: '场馆参考页',
    government: '政府参考页',
    transport_official: '公共交通参考页',
    dataset: '数据来源页',
  }[poi.referenceKind];
}

function friendlyCheckLabel(check: ConstraintCheck): string {
  if (check.id.startsWith('must_include:'))
    return check.label.replace('必去：', '已安排必去地点：');
  if (check.id.startsWith('exclude:'))
    return check.label.replace('避开：', '已避开：');
  return (
    {
      unique: '地点没有重复',
      window: '每天在合理时间内结束',
      overlap: '时间安排没有冲突',
      coverage: '每天都有午餐与下午活动',
      source: '地点资料有来源',
      low_walking: '已尽量减少步行',
      accessibility: '无障碍路线',
      opening_hours: '场馆营业时间',
      live_transit: '当天交通情况',
      prices: '门票与现场费用',
      central_city: '市中心优先',
      venue_preference: '室内外偏好',
      crowds: '现场拥挤程度',
    }[check.id] ?? check.label
  );
}

function friendlyCheckDetail(check: ConstraintCheck): string {
  const copy: Record<string, string> = {
    unique: '每个地点只安排一次。',
    overlap: '各项活动按顺序衔接，没有时间重叠。',
    source: '所用地点都有坐标和开放数据来源。',
    accessibility: '如果需要全程无障碍通行，请在出发前向场馆和交通运营方确认。',
    opening_hours: '营业时间可能变化，请在出发前查看每个场馆的官方页面。',
    live_transit: '当前路程按坐标估算，出发当天请使用地图或 PTV 查看实时路线。',
    prices: '景点门票采用 2026-09-15 的官方离线快照；活动和动态票价仍需确认。',
    crowds: '当前没有实时客流数据，可在出发前查看场馆公告或地图忙碌程度。',
  };
  return copy[check.id] ?? check.detail;
}

function poiNames(ids: string[]): string {
  return ids
    .map((id) => POIS.find((poi) => poi.id === id)?.nameZh ?? id)
    .join('、');
}

function interestSummary(result: PlannerResult): string {
  const preferred = EXPERIENCE_FACETS.filter(
    (facet) => result.request.experiencePreferences[facet.id] === 'prefer',
  ).map((facet) => facet.shortLabel);
  return preferred.length > 0 ? preferred.join(' · ') : '体验主题未指定';
}

function preferenceSummary(result: PlannerResult): string {
  const items = [
    result.request.pace === 'relaxed'
      ? '轻松'
      : result.request.pace === 'packed'
        ? '充实'
        : '均衡',
    result.request.lowWalking ? '少走路' : null,
    result.request.venuePreference.value !== 'neutral'
      ? venueLabel(result.request.venuePreference.value)
      : null,
    result.request.geography.scope === 'central_city_v1'
      ? '市中心优先'
      : result.request.geography.scope === 'cbd_core_v1'
        ? '仅 CBD'
        : null,
    result.request.avoidCrowds ? '避开拥挤待核实' : null,
    (result.request.mustIncludePoiIds?.length ?? 0) > 0
      ? `必去 ${result.request.mustIncludePoiIds.length}`
      : null,
    (result.request.excludePoiIds?.length ?? 0) > 0
      ? `避开 ${result.request.excludePoiIds.length}`
      : null,
  ].filter(Boolean);
  return items.join(' · ');
}
