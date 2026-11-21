import { Compass, ExternalLink } from 'lucide-react';

const SOURCES = [
  {
    label: 'City of Melbourne Open Data',
    href: 'https://data.melbourne.vic.gov.au/',
  },
  {
    label: 'Wikimedia Commons',
    href: 'https://commons.wikimedia.org/',
  },
  {
    label: 'Transport Victoria',
    href: 'https://transport.vic.gov.au/plan-a-journey/visitors-to-victoria',
  },
  {
    label: 'Queen Victoria Market',
    href: 'https://qvm.com.au/visit-us/',
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-slate-200 py-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-slate-950 text-white">
              <Compass aria-hidden="true" className="size-4" />
            </span>
            <p className="text-sm font-bold text-slate-950">
              Melbourne TripAgent
            </p>
          </div>
          <p className="mt-3 max-w-md text-xs leading-5 text-slate-500">
            面向第一次或短期到访墨尔本的中文旅行者。模型只读需求，地点、时间、费用和约束由可追溯数据与确定性代码负责。这是原型，不接预订、支付或实时余票。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-xs">
          <a className="text-slate-600 hover:text-slate-950" href="#plan">
            规划行程
          </a>
          <a className="text-slate-600 hover:text-slate-950" href="#discover">
            发现墨尔本
          </a>
          <a className="text-slate-600 hover:text-slate-950" href="#prepare">
            行前准备
          </a>
          <a className="text-slate-600 hover:text-slate-950" href="#about">
            项目说明
          </a>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] text-slate-400">
            DATA SOURCES
          </p>
          <ul className="mt-2 space-y-1.5 text-xs">
            {SOURCES.map((source) => (
              <li key={source.href}>
                <a
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
                  href={source.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.label}
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-6 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
        © 2026 Melbourne TripAgent · 照片与数据保留各自许可 · 页面中的时间、距离和费用均为估算，出发前请以官方信息为准
      </p>
    </footer>
  );
}
