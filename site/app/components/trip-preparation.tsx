'use client';

import { useMemo, type ReactNode } from 'react';
import { Backpack, ExternalLink, ShoppingBag, TramFront } from 'lucide-react';

import type { PlannerResult } from '@/app/lib/planner';
import {
  buildTripAdvice,
  type AdviceCard,
  type AdviceSource,
  type AdviceStatus,
} from '@/app/lib/trip-advice';

const STATUS_LABEL: Record<AdviceStatus, string> = {
  verified: '官方信息摘要',
  stale: '已过复核日期，请看官网',
  project_rule: '本站通用建议',
};

function SourceLinks({ sources }: { sources: AdviceSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {sources.map((source) => (
        <a
          className="inline-flex items-center gap-1 text-blue-800 hover:underline"
          href={source.url}
          key={source.url}
          rel="noreferrer"
          target="_blank"
        >
          {source.label}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ))}
    </p>
  );
}

function Card({ card, verifiedAt }: { card: AdviceCard; verifiedAt: string }) {
  return (
    <li
      className={`rounded-xl border p-3 ${
        card.priority === 'high'
          ? 'border-amber-300 bg-amber-50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-slate-950">{card.title}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            card.status === 'stale'
              ? 'bg-red-100 text-red-800'
              : card.status === 'verified'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-slate-100 text-slate-700'
          }`}
        >
          {STATUS_LABEL[card.status]}
          {card.status === 'verified' ? ` · 核对于 ${verifiedAt}` : ''}
        </span>
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-800">{card.body}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">为什么提醒你：{card.trigger}</p>
      <SourceLinks sources={card.sources} />
    </li>
  );
}

function Group({
  children,
  count,
  highCount,
  icon,
  title,
}: {
  children: ReactNode;
  count: number;
  highCount: number;
  icon: ReactNode;
  title: string;
}) {
  return (
    <details className="group rounded-2xl border border-slate-200 bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 font-semibold text-slate-900">
        {icon}
        {title}
        <span className="text-sm font-normal text-slate-500">{count} 条</span>
        {highCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            {highCount} 条要特别留意
          </span>
        ) : null}
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}

export function TripPreparation({ result }: { result: PlannerResult }) {
  const advice = useMemo(() => buildTripAdvice(result), [result]);
  const high = (cards: AdviceCard[]) =>
    cards.filter((card) => card.priority === 'high').length;
  return (
    <section aria-labelledby="prep-title" className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-blue-700">出发准备</p>
          <h2
            className="mt-1 text-xl font-bold tracking-tight text-slate-950"
            id="prep-title"
          >
            按这份行程要注意的事
          </h2>
        </div>
        <p className="text-xs text-slate-500">
          随行程更新 · 资料版本 {advice.snapshotVersion}
        </p>
      </div>
      <div className="mt-3 grid gap-2">
        {advice.transport.length > 0 ? (
          <Group
            count={advice.transport.length}
            highCount={high(advice.transport)}
            icon={<TramFront aria-hidden="true" className="size-4 text-blue-700" />}
            title="交通避坑"
          >
            <ul className="grid gap-2">
              {advice.transport.map((card) => (
                <Card card={card} key={card.id} verifiedAt={advice.verifiedAt} />
              ))}
            </ul>
          </Group>
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            交通避坑：这份行程目前都按步行安排，没有需要刷卡乘车的路段。
          </p>
        )}
        <Group
          count={advice.packing.items.length}
          highCount={0}
          icon={<Backpack aria-hidden="true" className="size-4 text-blue-700" />}
          title={`行李清单${advice.packing.seasonLabel ? ` · ${advice.packing.seasonLabel}` : ''}`}
        >
          <ul className="grid gap-2">
            {advice.packing.items.map((item) => (
              <li className="flex gap-2 text-sm" key={item.id}>
                <input
                  aria-label={item.text}
                  className="mt-1 size-4 shrink-0"
                  type="checkbox"
                />
                <span>
                  <span className="text-slate-950">{item.text}</span>
                  <span className="block text-xs leading-5 text-slate-600">
                    {item.reason}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            {advice.packing.note}
          </p>
          <SourceLinks sources={advice.packing.sources} />
        </Group>
        {advice.shopping.length > 0 ? (
          <Group
            count={advice.shopping.length}
            highCount={high(advice.shopping)}
            icon={<ShoppingBag aria-hidden="true" className="size-4 text-blue-700" />}
            title="购物"
          >
            <ul className="grid gap-2">
              {advice.shopping.map((card) => (
                <Card card={card} key={card.id} verifiedAt={advice.verifiedAt} />
              ))}
            </ul>
          </Group>
        ) : null}
      </div>
    </section>
  );
}
