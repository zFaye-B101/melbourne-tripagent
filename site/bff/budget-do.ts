import { DurableObject } from 'cloudflare:workers';
import { createCloudflareSqliteBudgetLedger } from 'llm-gateway-kit/cloudflare-budget';
import type { BudgetLedger } from 'llm-gateway-kit/budget-ledger';

interface BudgetEnv {
  LLM_BUDGET_PERIOD?: string;
  LLM_BUDGET_LIMIT_UNITS?: string;
}

/** Internal RPC only. No public Worker route exposes this object. */
export class TripBudgetDurableObject extends DurableObject<BudgetEnv> {
  private readonly ledger: BudgetLedger;

  constructor(ctx: DurableObjectState, env: BudgetEnv) {
    super(ctx, env);
    const rawLimit = env.LLM_BUDGET_LIMIT_UNITS;
    if (!rawLimit || !/^[1-9]\d*$/.test(rawLimit))
      throw new Error('budget_limit_unavailable');
    const limitUnits = Number(rawLimit);
    if (!Number.isSafeInteger(limitUnits))
      throw new Error('budget_limit_unavailable');
    this.ledger = createCloudflareSqliteBudgetLedger({
      storage: ctx.storage,
      budgetId: env.LLM_BUDGET_PERIOD ?? '',
      limitUnits,
    });
  }

  reserve(input: Parameters<BudgetLedger['reserve']>[0]) {
    return this.ledger.reserve(input);
  }

  settle(input: Parameters<BudgetLedger['settle']>[0]) {
    return this.ledger.settle(input);
  }
}
