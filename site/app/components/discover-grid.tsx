'use client';

import { useMemo, useState } from 'react';
import { Compass, Search, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PoiVisual } from '@/app/components/poi-visual';
import {
  getAdmissionPriceRecord,
  type Poi,
  type PoiCategory,
} from '@/app/lib/planner';

export type PoiCardPreference = 'default' | 'must' | 'avoid';

const CATEGORY_META: Record<
  PoiCategory,
  { label: string; chip: string; dot: string }
> = {
  art_culture: {
    label: '艺术与文化',
    chip: 'bg-violet-50 text-violet-800 border-violet-200',
    dot: 'bg-violet-500',
  },
  history: {
    label: '历史与遗产',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
  },
  nature: {
    label: '公园与花园',
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  city_landmark: {
    label: '城市地标',
    chip: 'bg-blue-50 text-blue-800 border-blue-200',
    dot: 'bg-blue-500',
  },
  market_food: {
    label: '市集与生活',
    chip: 'bg-rose-50 text-rose-800 border-rose-200',
    dot: 'bg-rose-500',
  },
  family: {
    label: '亲子活动',
    chip: 'bg-cyan-50 text-cyan-800 border-cyan-200',
    dot: 'bg-cyan-500',
  },
};

const FILTERS: Array<{ value: 'all' | PoiCategory; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'art_culture', label: '艺术' },
  { value: 'history', label: '历史' },
  { value: 'nature', label: '自然' },
  { value: 'city_landmark', label: '地标' },
  { value: 'market_food', label: '市集' },
  { value: 'family', label: '亲子' },
];

function matches(poi: Poi, query: string): boolean {
  if (!query.trim()) return true;
  const text = `${poi.nameZh} ${poi.nameEn} ${poi.area} ${poi.tags.join(' ')}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => text.includes(part));
}

function PreferenceButton({
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
      className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function DiscoverGrid({
  onOpenTrip,
  onPlan,
  onPreferenceChange,
  preferences,
  pois,
}: {
  onOpenTrip: () => void;
  onPlan: () => void;
  onPreferenceChange: (poiId: string, value: PoiCardPreference) => void;
  preferences: Record<string, PoiCardPreference>;
  pois: Poi[];
}) {
  const [filter, setFilter] = useState<'all' | PoiCategory>('all');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(
    () =>
      pois.filter(
        (poi) =>
          (filter === 'all' || poi.category === filter) &&
          matches(poi, query),
      ),
    [filter, pois, query],
  );
  const visible = showAll ? filtered : filtered.slice(0, 8);
  const mustCount = Object.values(preferences).filter(
    (value) => value === 'must',
  ).length;
  const avoidCount = Object.values(preferences).filter(
    (value) => value === 'avoid',
  ).length;

  return (
    <section aria-labelledby="discover-title" className="scroll-mt-24" id="discover">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.22em] text-teal-700">
            DISCOVER MELBOURNE
          </p>
          <h2
            className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl"
            id="discover-title"
          >
            40 个有来源的地点，先挑你非去不可的
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
            每个地点都保留了官方数据来源、照片作者和核验状态。设为必去或避开后，规划器会在
            1–3 天里优先安排或主动绕开；其余地点按你的主题和节奏来排。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="h-9 border-slate-300 bg-white hover:bg-slate-50"
            onClick={onOpenTrip}
            size="sm"
            variant="outline"
          >
            <Compass aria-hidden="true" />
            已选 {mustCount + avoidCount}
          </Button>
          <Button
            className="h-9 bg-slate-950 text-white hover:bg-slate-800"
            onClick={onPlan}
            size="sm"
          >
            带着这些去规划
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((item) => (
            <button
              aria-pressed={filter === item.value}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                filter === item.value
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
              key={item.value}
              onClick={() => {
                setFilter(item.value);
                setShowAll(false);
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">搜索地点</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          />
          <input
            className="h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索地点或区域"
            value={query}
          />
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
        <p className="flex items-center gap-1.5">
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          显示 {visible.length} / {filtered.length} 个地点
        </p>
        <p>
          必去 {mustCount} · 避开 {avoidCount}
        </p>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((poi) => {
          const preference = preferences[poi.id] ?? 'default';
          const meta = CATEGORY_META[poi.category];
          const price =
            getAdmissionPriceRecord(poi.id)?.displayText ?? '门票需确认';
          return (
            <article
              className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
              key={poi.id}
            >
              <div className="relative">
                <PoiVisual
                  className="aspect-[16/10] w-full rounded-none"
                  imageClassName="transition duration-500 group-hover:scale-[1.03]"
                  poi={poi}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                />
                <Badge
                  className={`absolute left-2 top-2 border bg-white/95 ${meta.chip}`}
                  variant="outline"
                >
                  <span className={`size-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </Badge>
              </div>
              <div className="flex flex-1 flex-col p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-slate-950">
                      {poi.nameZh}
                    </h3>
                    <p className="truncate text-xs text-slate-500">
                      {poi.nameEn}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {poi.suggestedMinutes} 分钟
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                  {poi.summary}
                </p>
                <p className="mt-2 truncate text-[11px] text-slate-500">
                  {poi.area} · {price}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <PreferenceButton
                    active={preference === 'default'}
                    onClick={() => onPreferenceChange(poi.id, 'default')}
                  >
                    默认
                  </PreferenceButton>
                  <PreferenceButton
                    active={preference === 'must'}
                    onClick={() => onPreferenceChange(poi.id, 'must')}
                  >
                    必去
                  </PreferenceButton>
                  <PreferenceButton
                    active={preference === 'avoid'}
                    onClick={() => onPreferenceChange(poi.id, 'avoid')}
                  >
                    避开
                  </PreferenceButton>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
          没有匹配的地点；换一个关键词，或者把筛选切回“全部”。
        </p>
      ) : null}

      {filtered.length > 8 ? (
        <div className="mt-6 flex justify-center">
          <Button
            className="border-slate-300 bg-white hover:bg-slate-50"
            onClick={() => setShowAll((value) => !value)}
            size="sm"
            variant="outline"
          >
            {showAll ? '收起列表' : `展开全部 ${filtered.length} 个地点`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
