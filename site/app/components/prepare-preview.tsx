import { Backpack, ExternalLink, ShoppingBag, TramFront } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

const CARDS = [
  {
    icon: TramFront,
    title: '交通避坑',
    body: '有公共交通路段时，提示 myki、感应刷卡、免费电车区和半价政策的适用范围，并附官方来源。',
    tag: '按实际路线触发',
  },
  {
    icon: Backpack,
    title: '行李清单',
    body: '按南半球季节、天数、同行人和步行强度列清单，每一项都写清楚为什么建议带。',
    tag: '不是天气预报',
  },
  {
    icon: ShoppingBag,
    title: '购物建议',
    body: '说清楚可以买什么、去哪类地方找，以及出发前要再核对什么；不保证库存、价格或退税资格。',
    tag: '不替商家承诺',
  },
];

export function PreparePreview() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {CARDS.map((card) => (
        <article
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          key={card.title}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-800">
              <card.icon aria-hidden="true" className="size-5" />
            </span>
            <Badge
              className="border-slate-200 bg-slate-50 text-slate-500"
              variant="outline"
            >
              {card.tag}
            </Badge>
          </div>
          <h3 className="mt-4 text-lg font-bold text-slate-950">{card.title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{card.body}</p>
        </article>
      ))}
      <p className="md:col-span-3">
        <a
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"
          href="https://transport.vic.gov.au/plan-a-journey/visitors-to-victoria"
          rel="noreferrer"
          target="_blank"
        >
          资料入口：Transport Victoria 访客页、Queen Victoria Market、Bureau of
          Meteorology
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </p>
    </div>
  );
}
