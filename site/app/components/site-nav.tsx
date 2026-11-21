import { Compass, MapPin, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

const NAV_LINKS = [
  { href: '#plan', label: '规划行程' },
  { href: '#discover', label: '发现墨尔本' },
  { href: '#prepare', label: '行前准备' },
  { href: '#about', label: '项目说明' },
];

export function SiteNav({
  configVersion,
  mustCount,
  avoidCount,
  onOpenTrip,
  onStartPlanning,
}: {
  configVersion: string;
  mustCount: number;
  avoidCount: number;
  onOpenTrip: () => void;
  onStartPlanning: () => void;
}) {
  const tripCount = mustCount + avoidCount;
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#f8f7f3]/92 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <a
          className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
          href="#top"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-slate-950 text-white shadow-sm">
            <Compass aria-hidden="true" className="size-4" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-bold tracking-tight text-slate-950">
              Melbourne TripAgent
            </span>
            <span className="block truncate text-[10px] font-semibold tracking-[0.18em] text-slate-500">
              MELBOURNE UNCOVERED
            </span>
          </span>
        </a>

        <nav
          aria-label="页面导航"
          className="hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-slate-400 lg:inline">
            配置 {configVersion}
          </span>
          <Button
            className="hidden h-9 border-slate-300 bg-white/70 text-slate-800 hover:bg-white sm:inline-flex"
            onClick={onOpenTrip}
            size="sm"
            variant="outline"
          >
            <MapPin aria-hidden="true" />
            我的行程
            <span className="rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-700">
              {tripCount}
            </span>
          </Button>
          <Button
            className="h-9 bg-slate-950 px-3 text-white hover:bg-slate-800"
            onClick={onStartPlanning}
            size="sm"
          >
            <Sparkles aria-hidden="true" />
            开始规划
          </Button>
        </div>
      </div>
      <nav
        aria-label="页面导航（移动端）"
        className="flex gap-1 overflow-x-auto border-t border-slate-200/60 px-3 py-1.5 md:hidden"
      >
        {NAV_LINKS.map((link) => (
          <a
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-950"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </a>
        ))}
        <button
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-white"
          onClick={onOpenTrip}
          type="button"
        >
          我的行程 · {tripCount}
        </button>
      </nav>
    </header>
  );
}
