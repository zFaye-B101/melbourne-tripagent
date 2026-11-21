'use client';

import { useState } from 'react';
import Image from 'next/image';
import { MapPin } from 'lucide-react';

import { getPoiPhoto } from '@/app/lib/poi-media';
import type { Poi, PoiCategory } from '@/app/lib/planner';
import { cn } from '@/lib/utils';

const CATEGORY_VISUALS: Record<
  PoiCategory,
  { label: string; className: string }
> = {
  art_culture: {
    label: '艺术与文化',
    className: 'from-violet-700 via-indigo-700 to-blue-700',
  },
  history: {
    label: '历史与遗产',
    className: 'from-amber-700 via-orange-700 to-rose-700',
  },
  nature: {
    label: '公园与花园',
    className: 'from-emerald-700 via-teal-700 to-cyan-700',
  },
  city_landmark: {
    label: '城市地标',
    className: 'from-blue-800 via-sky-700 to-cyan-600',
  },
  market_food: {
    label: '市集与生活',
    className: 'from-rose-700 via-orange-600 to-amber-600',
  },
  family: {
    label: '亲子活动',
    className: 'from-cyan-700 via-blue-700 to-violet-700',
  },
};

export function PoiVisual({
  className,
  compact = false,
  imageClassName,
  poi,
  sizes,
}: {
  className?: string;
  compact?: boolean;
  imageClassName?: string;
  poi: Poi;
  sizes: string;
}) {
  const [failed, setFailed] = useState(false);
  const photo = getPoiPhoto(poi.id);
  const category = CATEGORY_VISUALS[poi.category];

  return (
    <figure
      className={cn(
        'relative isolate overflow-hidden rounded-xl bg-slate-200',
        className,
      )}
      title={
        photo && !failed
          ? `${photo.alt}；${photo.attribution}`
          : photo
            ? `${poi.nameZh}的本地实景图未能加载，暂时显示${category.label}类别示意`
            : `${poi.nameZh}目前暂无已核验的本地实景图，显示${category.label}类别示意`
      }
    >
      {photo && !failed ? (
        <Image
          alt={photo.alt}
          className={cn('object-cover', imageClassName)}
          fill
          onError={() => setFailed(true)}
          sizes={sizes}
          src={photo.imageSrc}
        />
      ) : (
        <>
          <div
            aria-hidden="true"
            className={cn(
              'grid size-full place-items-center bg-gradient-to-br text-white',
              category.className,
            )}
          >
            <div className="grid place-items-center text-center">
              <MapPin className={compact ? 'size-5' : 'size-7'} />
              {compact ? null : (
                <span className="mt-1 px-2 text-xs font-semibold">
                  {category.label}
                </span>
              )}
            </div>
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-slate-950/65 px-1.5 py-0.5 text-xs font-medium text-white">
              地点示意
            </span>
          </div>
          <figcaption className="sr-only">
            {poi.nameZh}的{category.label}类别示意；
            {photo ? '本地实景图加载失败' : '暂无已核验实景图'}
          </figcaption>
        </>
      )}
    </figure>
  );
}
