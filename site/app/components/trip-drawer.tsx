'use client';

import { MapPin, Route, Trash2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PoiVisual } from '@/app/components/poi-visual';
import type { PoiCardPreference } from '@/app/components/discover-grid';
import type { Poi } from '@/app/lib/planner';

export function TripDrawer({
  onClear,
  onDiscover,
  onOpenChange,
  onPlan,
  onRemove,
  open,
  pois,
  preferences,
}: {
  onClear: () => void;
  onDiscover: () => void;
  onOpenChange: (open: boolean) => void;
  onPlan: () => void;
  onRemove: (poiId: string) => void;
  open: boolean;
  pois: Poi[];
  preferences: Record<string, PoiCardPreference>;
}) {
  const must = pois.filter((poi) => preferences[poi.id] === 'must');
  const avoid = pois.filter((poi) => preferences[poi.id] === 'avoid');
  const total = must.length + avoid.length;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-md"
        side="right"
      >
        <SheetHeader className="border-b border-slate-100 pb-4">
          <p className="text-xs font-bold tracking-[0.2em] text-teal-700">
            MY TRIP
          </p>
          <SheetTitle className="text-2xl">我的行程</SheetTitle>
          <SheetDescription>
            必去会优先进行程，避开会被排除。它们会和你之后写的描述一起交给规划器。
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {total === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <MapPin
                aria-hidden="true"
                className="mx-auto size-6 text-slate-400"
              />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                还没有选地点
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                去“发现墨尔本”把最想去的和不想去的标出来；也可以直接写一句话让规划器先排。
              </p>
              <Button
                className="mt-4"
                onClick={onDiscover}
                size="sm"
                variant="outline"
              >
                去发现地点
              </Button>
            </div>
          ) : null}

          {must.length > 0 ? (
            <section aria-labelledby="trip-must">
              <div className="flex items-center justify-between">
                <h3
                  className="text-xs font-bold tracking-[0.16em] text-emerald-700"
                  id="trip-must"
                >
                  必去 · {must.length}
                </h3>
                <Badge className="bg-emerald-50 text-emerald-800" variant="secondary">
                  优先安排
                </Badge>
              </div>
              <ul className="mt-2 space-y-2">
                {must.map((poi) => (
                  <TripRow
                    key={poi.id}
                    onRemove={() => onRemove(poi.id)}
                    poi={poi}
                    tone="must"
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {avoid.length > 0 ? (
            <section aria-labelledby="trip-avoid" className="mt-6">
              <div className="flex items-center justify-between">
                <h3
                  className="text-xs font-bold tracking-[0.16em] text-rose-700"
                  id="trip-avoid"
                >
                  避开 · {avoid.length}
                </h3>
                <Badge className="bg-rose-50 text-rose-800" variant="secondary">
                  行程排除
                </Badge>
              </div>
              <ul className="mt-2 space-y-2">
                {avoid.map((poi) => (
                  <TripRow
                    key={poi.id}
                    onRemove={() => onRemove(poi.id)}
                    poi={poi}
                    tone="avoid"
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <SheetFooter className="border-t border-slate-100 pt-4 sm:flex-col">
          <Button
            className="h-10 w-full bg-slate-950 text-white hover:bg-slate-800"
            onClick={onPlan}
          >
            <Route aria-hidden="true" />
            带着这些去规划
          </Button>
          {total > 0 ? (
            <Button
              className="h-9 w-full text-slate-600"
              onClick={onClear}
              variant="ghost"
            >
              <Trash2 aria-hidden="true" />
              清空选择
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TripRow({
  onRemove,
  poi,
  tone,
}: {
  onRemove: () => void;
  poi: Poi;
  tone: 'must' | 'avoid';
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
      <PoiVisual
        className="size-14 shrink-0 rounded-lg"
        compact
        poi={poi}
        sizes="56px"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">
          {poi.nameZh}
        </p>
        <p className="truncate text-[11px] text-slate-500">
          {poi.area} · {poi.nameEn}
        </p>
        <span
          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            tone === 'must'
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-rose-50 text-rose-800'
          }`}
        >
          {tone === 'must' ? '必去' : '避开'}
        </span>
      </div>
      <button
        aria-label={`移除 ${poi.nameZh}`}
        className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        onClick={onRemove}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}
