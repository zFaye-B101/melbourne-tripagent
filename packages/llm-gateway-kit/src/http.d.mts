export type CallerIdentity = { subjectKey: string };
export type MaybePromise<T> = T | Promise<T>;
export type RateLimitHook = (input: { subjectKey: string; taskId: string }) => MaybePromise<true | false | null | undefined>;
export type BudgetReservation = { reservationId: string };
export type ReserveBudgetHook = (input: { subjectKey: string; taskId: string; requestId: string; maxCostUnits: number }) => MaybePromise<BudgetReservation | false | null | undefined>;
export type SettleBudgetHook = (input: { subjectKey: string; taskId: string; reservationId: string; outcome: 'success' | 'unknown' }) => MaybePromise<true | false | null | undefined>;
export type VerifyCallerHook = (request: Request) => MaybePromise<CallerIdentity | false | null | undefined>;
export interface StructuredRunner {
  run(input: { taskId: string; text: string; signal: AbortSignal }): Promise<{ ok: true; value: unknown; taskVersion: string } | { ok: false; code: string }>;
}
export interface StructuredTaskBffOptions {
  path: string;
  taskId: string;
  runner: StructuredRunner;
  enabled?: boolean;
  allowedOrigins: string[];
  maxRequestBytes?: number;
  maxTextLength?: number;
  deadlineMs?: number;
  maxCostUnits?: number;
  verifyCaller?: VerifyCallerHook;
  consumeRateLimit?: RateLimitHook;
  reserveBudget?: ReserveBudgetHook;
  settleBudget?: SettleBudgetHook;
}
export function createStructuredTaskBff(options: StructuredTaskBffOptions): (request: Request) => Promise<Response>;
