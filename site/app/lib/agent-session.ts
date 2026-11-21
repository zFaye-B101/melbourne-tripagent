import {
  experienceFacetLabel,
  formatTime,
  parseTripRequest,
  type ExperienceFacet,
  type ParsedTripRequest,
} from './planner';
import {
  DEFAULT_RULES_DIAGNOSTICS,
  type FieldEvidenceV2,
  type ParserDiagnostics,
} from './nlu-contract';

export {
  DEFAULT_RULES_DIAGNOSTICS,
  type FieldEvidenceV2,
  type ParserDiagnostics,
  type ParserFallbackReasonCode,
} from './nlu-contract';

export type AgentSessionPhase =
  | 'idle'
  | 'interpreting'
  | 'needs_clarification'
  | 'awaiting_confirmation'
  | 'planning'
  | 'plan_ready'
  | 'error';

export function phaseAfterSourceChange(
  hasExistingPlan: boolean,
): AgentSessionPhase {
  return hasExistingPlan ? 'plan_ready' : 'idle';
}

export function canCommitPlanning({
  revision,
  activeRevision,
  proposalFingerprint,
  currentFingerprint,
}: {
  revision: number;
  activeRevision: number;
  proposalFingerprint: string;
  currentFingerprint: string;
}): boolean {
  return (
    revision === activeRevision && proposalFingerprint === currentFingerprint
  );
}

export interface ProposalSummaryItem {
  id: string;
  label: string;
  value: string;
  source: 'user' | 'manual' | 'agent_default' | 'needs_confirmation';
  evidence: string | null;
}

export interface PlanProposal {
  id: string;
  request: ParsedTripRequest;
  summary: ProposalSummaryItem[];
  createdFrom: string;
  diagnostics: ParserDiagnostics;
  fieldEvidence: FieldEvidenceV2[];
}

export function buildPlanProposal(
  request: ParsedTripRequest,
  sourceFingerprint: string,
  diagnostics: ParserDiagnostics = DEFAULT_RULES_DIAGNOSTICS,
  fieldEvidence: FieldEvidenceV2[] = [],
): PlanProposal {
  return {
    id: proposalHash(`${sourceFingerprint}\n${JSON.stringify(request)}`),
    request: structuredClone(request),
    summary: summarizeProposal(request, fieldEvidence),
    createdFrom: sourceFingerprint,
    diagnostics: { ...diagnostics },
    fieldEvidence: structuredClone(fieldEvidence),
  };
}

export function isProposalCurrent(
  proposal: PlanProposal | null,
  sourceFingerprint: string,
): boolean {
  return proposal?.createdFrom === sourceFingerprint;
}

export function summarizeProposal(
  request: ParsedTripRequest,
  fieldEvidence: FieldEvidenceV2[] = [],
): ProposalSummaryItem[] {
  const preferredExperiences = Object.entries(request.experiencePreferences)
    .filter(([, preference]) => preference === 'prefer')
    .map(([facet]) => facet as ExperienceFacet);
  const textOnlyExperiences = parseTripRequest(
    request.rawText,
  ).experiencePreferences;
  const evidencePaths = new Set(fieldEvidence.map((item) => item.path));
  const avoidedExperiences = Object.entries(request.experiencePreferences)
    .filter(([, preference]) => preference === 'avoid')
    .map(([facet]) => facet as ExperienceFacet);

  const summary: ProposalSummaryItem[] = [
    {
      id: 'days',
      label: '天数',
      value: request.days ? `${request.days} 天` : '待确认',
      source:
        request.days === null
          ? 'needs_confirmation'
          : fieldSourceLabel(request.daysSource),
      evidence:
        request.daysSource === 'text'
          ? findEvidence(request.rawText, /[1-9一二两三四五六七八九]\s*天/)
          : null,
    },
    {
      id: 'origin',
      label: '每天起点',
      value: request.origin.label,
      source: fieldSourceLabel(request.origin.source),
      evidence: request.origin.evidence,
    },
    {
      id: 'time',
      label: '每天出发',
      value: formatTime(request.dailyWindow.startMinutes),
      source: fieldSourceLabel(request.dailyWindow.startSource),
      evidence: request.dailyWindow.evidence,
    },
    {
      id: 'pace',
      label: '节奏',
      value:
        request.pace === 'relaxed'
          ? '轻松（2–3 个地点）'
          : request.pace === 'packed'
            ? '紧凑（约 4 个地点）'
            : '均衡（3–4 个地点）',
      source: fieldSourceLabel(request.paceSource),
      evidence:
        request.paceSource === 'text'
          ? findEvidence(
              request.rawText,
              /(轻松|休闲|慢慢|充实|多安排|紧凑|relaxed|packed)/i,
            )
          : null,
    },
    {
      id: 'venue',
      label: '室内外偏好',
      value: venueLabel(request.venuePreference.value),
      source: fieldSourceLabel(request.venuePreference.source),
      evidence: request.venuePreference.evidence,
    },
    {
      id: 'area',
      label: '主要活动区域',
      value:
        request.geography.scope === 'cbd_core_v1'
          ? '只在 CBD'
          : request.geography.scope === 'central_city_v1'
            ? '市中心优先'
            : '墨尔本市区及内城区',
      source: fieldSourceLabel(request.geography.source),
      evidence: request.geography.evidence,
    },
  ];

  const party = [
    `${request.pricingParty.adultFullFareCount} 位成人`,
    request.pricingParty.concessionEligibleCount > 0
      ? `${request.pricingParty.concessionEligibleCount} 位优惠票旅客`
      : null,
    request.pricingParty.childAges.length > 0
      ? `儿童 ${request.pricingParty.childAges.join('、')} 岁`
      : null,
  ].filter(Boolean);
  summary.push({
    id: 'travelers',
    label: '同行人员',
    value:
      request.pricingParty.ticketBreakdownStatus === 'complete'
        ? party.join(' · ')
        : `${request.pricingParty.totalTravelers ?? '人数待确认'}${request.pricingParty.totalTravelers === null ? '' : ' 人同行'} · 票型待确认`,
    source:
      request.pricingParty.source === 'user_selected'
        ? 'manual'
        : request.pricingParty.source === 'text'
          ? 'user'
          : 'agent_default',
    evidence: firstEvidence(fieldEvidence, '/party/'),
  });

  const userPreferredExperiences = preferredExperiences.filter(
    (facet) =>
      textOnlyExperiences[facet] === 'prefer' ||
      evidencePaths.has(`/experiencePreferences/${facet}`),
  );
  const manuallyPreferredExperiences = preferredExperiences.filter(
    (facet) => !userPreferredExperiences.includes(facet),
  );
  if (userPreferredExperiences.length > 0) {
    summary.push({
      id: 'experiences-user',
      label: '想体验',
      value: userPreferredExperiences.map(experienceFacetLabel).join('、'),
      source: 'user',
      evidence:
        firstFacetEvidence(fieldEvidence, userPreferredExperiences) ??
        findEvidence(
          request.rawText,
          combinedExperienceEvidence(userPreferredExperiences),
        ),
    });
  }
  if (manuallyPreferredExperiences.length > 0) {
    summary.push({
      id: 'experiences-manual',
      label: userPreferredExperiences.length > 0 ? '另外想体验' : '想体验',
      value: manuallyPreferredExperiences.map(experienceFacetLabel).join('、'),
      source: 'manual',
      evidence: null,
    });
  }
  const userAvoidedExperiences = avoidedExperiences.filter((facet) =>
    evidencePaths.has(`/experiencePreferences/${facet}`),
  );
  const manuallyAvoidedExperiences = avoidedExperiences.filter(
    (facet) => !userAvoidedExperiences.includes(facet),
  );
  if (userAvoidedExperiences.length > 0) {
    summary.push({
      id: 'avoid-experiences-user',
      label: '少安排',
      value: userAvoidedExperiences.map(experienceFacetLabel).join('、'),
      source: 'user',
      evidence: firstFacetEvidence(fieldEvidence, userAvoidedExperiences),
    });
  }
  if (manuallyAvoidedExperiences.length > 0) {
    summary.push({
      id: 'avoid-experiences-manual',
      label: '少安排',
      value: manuallyAvoidedExperiences.map(experienceFacetLabel).join('、'),
      source: 'manual',
      evidence: null,
    });
  }
  if (request.lowWalking) {
    summary.push({
      id: 'walking',
      label: '步行',
      value: '尽量少走路',
      source:
        evidencePaths.has('/lowWalking') ||
        /少走路|少步行|不想走|老人|长辈/i.test(request.rawText)
          ? 'user'
          : 'manual',
      evidence:
        firstEvidence(fieldEvidence, '/lowWalking') ??
        findEvidence(request.rawText, /(少走路|少步行|不想走|老人|长辈)/i),
    });
  }
  if (request.family) {
    summary.push({
      id: 'family',
      label: '同行需求',
      value: '亲子友好',
      source:
        evidencePaths.has('/family') ||
        /亲子|孩子|儿童|家庭/i.test(request.rawText)
          ? 'user'
          : 'manual',
      evidence:
        firstEvidence(fieldEvidence, '/family') ??
        findEvidence(request.rawText, /(亲子|孩子|儿童|家庭)/i),
    });
  }
  if (request.totalBudgetCents != null) {
    summary.push({
      id: 'budget',
      label: '旅行预算',
      value: `A$${(request.totalBudgetCents / 100).toFixed(0)}`,
      source:
        evidencePaths.has('/budget/totalCents') ||
        /预算|budget/i.test(request.rawText)
          ? 'user'
          : 'manual',
      evidence:
        firstEvidence(fieldEvidence, '/budget/totalCents') ??
        findEvidence(request.rawText, /(?:预算|budget)[^,，。；;\n]*/i),
    });
  }
  const lodging = request.costAssumptions?.accommodation;
  if (lodging) {
    const perNight =
      lodging.perNightMinCents === lodging.perNightMaxCents
        ? `A$${lodging.perNightMinCents / 100}`
        : `A$${lodging.perNightMinCents / 100}–${lodging.perNightMaxCents / 100}`;
    summary.push({
      id: 'lodging-assumption',
      label: '住宿估算（你的假设）',
      value: `每晚 ${perNight}${lodging.nights ? ` × ${lodging.nights} 晚` : '，住几晚待补充'}`,
      source: lodging.source === 'text' ? 'user' : 'manual',
      evidence: lodging.evidence,
    });
  }
  const food = request.costAssumptions?.food;
  if (food) {
    const perDay =
      food.perPersonPerDayMinCents === food.perPersonPerDayMaxCents
        ? `A$${food.perPersonPerDayMinCents / 100}`
        : `A$${food.perPersonPerDayMinCents / 100}–${food.perPersonPerDayMaxCents / 100}`;
    summary.push({
      id: 'food-assumption',
      label: '餐饮估算（你的假设）',
      value: `每人每天 ${perDay}`,
      source: food.source === 'text' ? 'user' : 'manual',
      evidence: food.evidence,
    });
  }
  return summary;
}

function fieldSourceLabel(
  source: ParsedTripRequest['daysSource'],
): ProposalSummaryItem['source'] {
  if (source === 'text') return 'user';
  if (source === 'structured') return 'manual';
  return 'agent_default';
}

function venueLabel(
  value: ParsedTripRequest['venuePreference']['value'],
): string {
  return {
    strong_indoor: '室内为主',
    indoor: '偏室内',
    neutral: '室内外均衡',
    outdoor: '偏户外',
    strong_outdoor: '户外为主',
  }[value];
}

const EXPERIENCE_EVIDENCE: Record<ExperienceFacet, RegExp> = {
  museum_exhibition: /博物馆|美术馆|展览|画廊|影像|museum|gallery|exhibition/i,
  history_heritage: /历史|人文|建筑|遗产|监狱|教堂|history|heritage/i,
  parks_gardens: /花园|自然|公园|植物|garden|nature|park/i,
  river_city_walk: /河畔|河边|散步|步道|漫步|桥梁|river|walk|promenade/i,
  city_icons_views: /地标|城市风景|观景|天际线|landmark|skyline|view/i,
  performance_music: /演出|音乐|剧院|音乐厅|concert|theatre|performance/i,
  sports_venues: /体育|球场|网球|赛事|sport|stadium|arena/i,
  market_local_life: /市场|市集|本地生活|market|local life/i,
};

function combinedExperienceEvidence(facets: ExperienceFacet[]): RegExp {
  return new RegExp(
    facets.map((facet) => EXPERIENCE_EVIDENCE[facet].source).join('|'),
    'i',
  );
}

function findEvidence(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[0] ?? null;
}

function firstEvidence(
  evidence: FieldEvidenceV2[],
  pathOrPrefix: string,
): string | null {
  return (
    evidence.find((item) =>
      pathOrPrefix.endsWith('/')
        ? item.path.startsWith(pathOrPrefix)
        : item.path === pathOrPrefix,
    )?.quote ?? null
  );
}

function firstFacetEvidence(
  evidence: FieldEvidenceV2[],
  facets: ExperienceFacet[],
): string | null {
  const paths = new Set(
    facets.map((facet) => `/experiencePreferences/${facet}`),
  );
  return evidence.find((item) => paths.has(item.path))?.quote ?? null;
}

function proposalHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `proposal-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
