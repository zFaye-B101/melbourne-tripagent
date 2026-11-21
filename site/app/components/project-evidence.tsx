import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  MessageSquareText,
  Route,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';

const STEPS = [
  {
    icon: MessageSquareText,
    step: '01',
    title: '你说一句中文',
    body: '天数、同行人、住宿区域、节奏、主题、必去和避开，可以混在一句话里。',
  },
  {
    icon: Sparkles,
    step: '02',
    title: '它只读需求',
    body: '本地规则或云端模型把文字抽成结构化草稿；每个值都必须有原文证据，模型不能挑景点。',
  },
  {
    icon: ShieldCheck,
    step: '03',
    title: '你逐项核对',
    body: '默认值、来源和冲突都摆出来；改输入会让旧确认失效，确认后才生成行程。',
  },
  {
    icon: Route,
    step: '04',
    title: '代码排出行程',
    body: '确定性规划器从 40 个有来源地点中筛选、分天、排时间、算费用，换点只动目标日期。',
  },
];

const FACTS = [
  '40 个地点保留官方原始数据、照片作者、许可和核验日期',
  '30 题固定评测集；已支持题的硬检查 20/20 通过',
  '478 项自动化测试覆盖解析、排程、换点、费用和接口',
  '换点最多 20 步撤销；模型失败时保留上一份成功行程',
];

const LIMITS = [
  '没有实时房价、天气、营业时间或活动余票；页面不会假装知道',
  '酒店星级/设施和日期活动仍受资料来源门限制，没通过就不展示具体候选',
  '地点间距离是坐标直线估算，不是导航路线；不判断某段电车是否在免费区',
  '这是原型，不接登录、预订或支付；费用估算会区分已核实、用户假设和未知项',
];

export function ProjectEvidence() {
  return (
    <section
      aria-labelledby="about-title"
      className="scroll-mt-24 overflow-hidden rounded-3xl bg-[#0f172a] px-5 py-10 text-white shadow-xl sm:px-8 lg:px-10"
      id="about"
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="text-xs font-bold tracking-[0.22em] text-teal-300">
            HOW IT WORKS
          </p>
          <h2
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
            id="about-title"
          >
            不是让 AI 替你决定，
            <br />
            是把决定拆成能核对的小步。
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
            这个项目最在意的不是“看起来像 AI”，而是每一段安排都能解释：为什么读成这个条件、为什么排这个地点、为什么这笔费用是未知。模型只做它擅长的文字理解；地点、时间、预算和约束始终由有来源的数据与可测试的代码负责。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge className="border-white/15 bg-white/10 text-slate-100" variant="outline">
              React + Vite
            </Badge>
            <Badge className="border-white/15 bg-white/10 text-slate-100" variant="outline">
              TypeScript
            </Badge>
            <Badge className="border-white/15 bg-white/10 text-slate-100" variant="outline">
              确定性规划器
            </Badge>
            <Badge className="border-white/15 bg-white/10 text-slate-100" variant="outline">
              Draft v2 + evidence
            </Badge>
            <Badge className="border-white/15 bg-white/10 text-slate-100" variant="outline">
              运行时配置热更新
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {STEPS.map((step) => (
            <article
              className="rounded-2xl border border-white/10 bg-white/[0.06] p-4"
              key={step.step}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-[0.18em] text-teal-300">
                  {step.step}
                </span>
                <step.icon aria-hidden="true" className="size-4 text-slate-300" />
              </div>
              <h3 className="mt-3 text-sm font-bold text-white">{step.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-300">
                {step.body}
              </p>
            </article>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5 border-t border-white/10 pt-7 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-300" />
            <h3 className="text-sm font-bold text-white">可以核对的事实</h3>
          </div>
          <ul className="mt-3 space-y-2.5">
            {FACTS.map((fact) => (
              <li className="flex gap-2 text-xs leading-5 text-slate-300" key={fact}>
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-300" />
                {fact}
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['40', '有来源地点'],
              ['30', '题固定评测'],
              ['20/20', '支持题硬检查'],
            ].map(([value, label]) => (
              <div
                className="rounded-xl border border-white/10 bg-white/[0.05] p-3"
                key={label}
              >
                <p className="text-lg font-bold text-white">{value}</p>
                <p className="mt-0.5 text-[10px] leading-4 text-slate-400">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="size-4 text-amber-300" />
            <h3 className="text-sm font-bold text-white">还做不到的事</h3>
          </div>
          <ul className="mt-3 space-y-2.5">
            {LIMITS.map((limit) => (
              <li className="flex gap-2 text-xs leading-5 text-slate-300" key={limit}>
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-300" />
                {limit}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-7 flex flex-col gap-3 border-t border-white/10 pt-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5">
          <Database aria-hidden="true" className="size-3.5" />
          数据：City of Melbourne Open Data（CC BY 4.0） · Wikimedia Commons ·
          Transport Victoria · Queen Victoria Market · BOM
        </p>
        <p className="flex items-center gap-1.5">
          <GitBranch aria-hidden="true" className="size-3.5" />
          源代码与评测记录保存在项目仓库
        </p>
      </div>
    </section>
  );
}
