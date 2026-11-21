'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { POIS, type Poi } from '@/app/lib/planner';
import { FEATURED_POI_PHOTOS } from '@/app/lib/poi-media';
import { PoiVisual } from '@/app/components/poi-visual';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel';

export type PoiCardPreference = 'default' | 'must' | 'avoid';

function buildFeaturedPois() {
  return FEATURED_POI_PHOTOS.map((media) => ({
    media,
    poi: POIS.find((poi) => poi.id === media.poiId),
  }))
    .filter(
      (
        item,
      ): item is {
        media: (typeof FEATURED_POI_PHOTOS)[number];
        poi: Poi;
      } => Boolean(item.poi),
    )
    .sort((a, b) => a.media.editorialOrder - b.media.editorialOrder);
}

export function FeaturedPois({
  onPreferenceChange,
  preferences,
}: {
  onPreferenceChange: (poiId: string, value: PoiCardPreference) => void;
  preferences: Record<string, PoiCardPreference>;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const featuredPois = buildFeaturedPois();
  const [activeIndex, setActiveIndex] = useState(0);
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  useEffect(() => {
    if (!api) return;
    const sync = () => {
      setActiveIndex(api.selectedScrollSnap());
      setCanScrollPrevious(api.canScrollPrev());
      setCanScrollNext(api.canScrollNext());
    };
    sync();
    api.on('select', sync);
    api.on('reInit', sync);
    return () => {
      api.off('select', sync);
      api.off('reInit', sync);
    };
  }, [api]);

  const counts = useMemo(() => {
    const values = Object.values(preferences);
    return {
      must: values.filter((value) => value === 'must').length,
      avoid: values.filter((value) => value === 'avoid').length,
    };
  }, [preferences]);

  const updatePreference = useCallback(
    (poiId: string, value: PoiCardPreference) => {
      onPreferenceChange(poiId, value);
    },
    [onPreferenceChange],
  );

  return (
    <section
      aria-labelledby="featured-title"
      className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-xs font-semibold text-blue-700">找点灵感</p>
            <h2
              className="text-lg font-bold text-slate-950"
              id="featured-title"
            >
              第一次来可以从这里选
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            10 个编辑精选 · 分类为项目整理，非实时热度
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-1 text-xs text-slate-600">
            必去 {counts.must} · 避开 {counts.avoid} ·{' '}
            {Math.min(activeIndex + 1, featuredPois.length)} /{' '}
            {featuredPois.length}
          </span>
          <Button
            aria-label="上一组景点"
            className="size-9 rounded-full bg-white"
            disabled={!canScrollPrevious}
            onClick={() => api?.scrollPrev()}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            aria-label="下一组景点"
            className="size-9 rounded-full bg-white"
            disabled={!canScrollNext}
            onClick={() => api?.scrollNext()}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div>
        <Carousel
          aria-label="墨尔本精选景点，共 10 张；可拖动或使用左右方向键浏览"
          opts={{
            align: 'start',
            containScroll: 'trimSnaps',
            loop: false,
            duration: 24,
          }}
          setApi={setApi}
        >
          <CarouselContent className="-ml-3">
            {featuredPois.map(({ media, poi }, index) => {
              const value = preferences[poi.id] ?? 'default';
              return (
                <CarouselItem
                  aria-label={`${index + 1} / ${featuredPois.length}：${poi.nameZh}`}
                  className="basis-[82%] pl-3 sm:basis-1/2 lg:basis-1/3"
                  key={poi.id}
                >
                  <article className="group h-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <div className="relative">
                      <PoiVisual
                        className="aspect-[16/9] rounded-none sm:aspect-[16/7]"
                        imageClassName="transition duration-500 group-hover:scale-[1.02]"
                        poi={poi}
                        sizes="(min-width: 1024px) 340px, (min-width: 640px) 48vw, 78vw"
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-slate-950/75 px-2 py-1 text-xs font-medium text-white">
                        {categoryLabel(poi)}
                      </span>
                    </div>
                    <div className="p-2.5">
                      <h3 className="font-bold text-slate-950">{poi.nameZh}</h3>
                      <p className="truncate text-xs text-slate-500">
                        {poi.nameEn}
                      </p>
                      <p className="mt-1.5 line-clamp-2 min-h-10 text-sm leading-5 text-slate-700">
                        {shortSummary(poi)}
                      </p>
                      <a
                        className="mt-1 block truncate text-xs text-slate-500 hover:text-blue-800 hover:underline"
                        href={media.sourcePageUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        照片：{media.author} · {media.license}
                      </a>
                      <fieldset className="mt-2">
                        <legend className="sr-only">
                          设置 {poi.nameZh} 的偏好
                        </legend>
                        <div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
                          {(
                            [
                              ['default', '默认', Circle],
                              ['must', '必去', ShieldCheck],
                              ['avoid', '避开', XCircle],
                            ] as const
                          ).map(([choice, label, Icon]) => (
                            <label
                              className={`flex min-h-9 cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-xs font-semibold ${value === choice ? (choice === 'must' ? 'bg-emerald-100 text-emerald-900' : choice === 'avoid' ? 'bg-red-100 text-red-900' : 'bg-blue-100 text-blue-900') : 'text-slate-600 hover:bg-slate-100'}`}
                              key={choice}
                            >
                              <input
                                checked={value === choice}
                                className="sr-only"
                                name={`poi-pref-${poi.id}`}
                                onChange={() =>
                                  updatePreference(poi.id, choice)
                                }
                                type="radio"
                                value={choice}
                              />
                              <Icon aria-hidden="true" className="size-3.5" />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </article>
                </CarouselItem>
              );
            })}
          </CarouselContent>
        </Carousel>
      </div>
    </section>
  );
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

function shortSummary(poi: Poi): string {
  const fallback = poi.summary.split(/[。；]/)[0];
  const curated: Record<string, string> = {
    'mel-cbd-federation-square':
      '城市会客厅，适合从建筑、河畔与文化场馆开始认识墨尔本。',
    'mel-cbd-acmi': '在联邦广场探索电影、电视、游戏与数字文化。',
    'mel-arts-ngv-international':
      '澳洲历史最悠久的公共美术馆，常设馆藏可免费参观。',
    'mel-cbd-state-library': '圆顶阅览室与城市历史氛围兼具的免费公共文化空间。',
    'mel-cbd-qvm': '老牌市集，适合感受本地日常、采购食材与简单用餐。',
    'mel-carlton-melbourne-museum': '自然、文化与儿童展区丰富，适合安排半天。',
    'mel-south-royal-botanic-gardens':
      '湖泊、草坪与植物景观组成的市中心大型花园。',
    'mel-east-fitzroy-gardens': '林荫步道、温室与历史景观相连，适合轻松散步。',
    'mel-cbd-old-melbourne-gaol':
      '以蓝石监狱建筑和殖民时期司法史为主的历史景点。',
    'mel-eureka-skydeck-88-dc7ebb76': '从高空俯瞰 CBD、雅拉河与城市天际线。',
  };
  return curated[poi.id] ?? `${fallback}。`;
}
