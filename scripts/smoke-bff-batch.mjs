// A bounded, repeatable local-only acceptance set for the real NLU provider.
// Running this script makes billable external API requests. It requires --run.
const endpoint = process.env.TRIPAGENT_BFF_URL ?? "http://localhost:8787/v1/trip-requests/parse";
const datasetVersion = "mel-poi-v0.1-2026-09-14";
const cases = [
  {
    id: "full-constraints",
    text: "墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE",
    checks: (body) => ({
      ready: body.decision === "ready",
      days: body.request?.days === 3,
      start: body.request?.dailyWindow?.startMinutes === 660,
      origin: body.request?.origin?.refId === "mel-cbd-proxy-flinders",
      budget: body.request?.totalBudgetCents === 50000,
      mustGo: body.request?.mustIncludePoiIds?.includes("mel-arts-ngv-international") === true,
      avoid: body.request?.excludePoiIds?.includes("mel-melbourne-aquarium-ce537795") === true,
    }),
  },
  {
    id: "natural-paraphrase",
    text: "想在墨尔本逛两天，住在 Southbank，上午十点出门，想看看花园和老建筑，行程别太赶。",
    checks: (body) => ({
      ready: body.decision === "ready",
      days: body.request?.days === 2,
      start: body.request?.dailyWindow?.startMinutes === 600,
      origin: body.request?.origin?.refId === "mel-southbank-proxy-skydeck",
      relaxed: body.request?.pace === "relaxed",
    }),
  },
  {
    id: "child-and-party",
    text: "墨尔本玩 1 天，带 6 岁孩子和两位成人，从 Carlton 出发，喜欢公园和博物馆。",
    checks: (body) => ({
      ready: body.decision === "ready",
      days: body.request?.days === 1,
      origin: body.request?.origin?.refId === "mel-carlton-proxy-museum",
      adults: body.request?.pricingParty?.adultFullFareCount === 2,
      childAge: body.request?.pricingParty?.childAges?.includes(6) === true,
    }),
  },
  {
    id: "missing-days",
    text: "第一次去墨尔本，住在 CBD，喜欢历史和花园，想轻松一点。",
    checks: (body) => ({
      asksDays: body.decision === "clarification" && body.question?.field === "days",
      noInventedDays: body.request?.days === null,
      origin: body.request?.origin?.refId === "mel-cbd-proxy-flinders",
    }),
  },
  {
    id: "four-days-out-of-scope",
    text: "墨尔本玩 4 天，主要在市区，喜欢艺术。",
    checks: (body) => ({
      scopeError: body.decision === "scope_error",
      noShortenedTrip: body.request === null,
    }),
  },
  {
    id: "sydney-out-of-scope",
    text: "悉尼玩 2 天，喜欢海边和博物馆。",
    checks: (body) => ({
      scopeError: body.decision === "scope_error",
      noMelbourneTrip: body.request === null,
    }),
  },
  {
    id: "non-aud-budget",
    text: "墨尔本玩 2 天，总预算 500 人民币，喜欢美术馆。",
    checks: (body) => ({
      asksForSupportedBudget: body.decision === "scope_error",
      noCurrencyConversionOrTrip: body.request === null,
    }),
  },
  {
    id: "relative-date-fuzzy-start",
    text: "下周末去墨尔本玩 2 天，每天晚一点出门，想去 NGV。",
    checks: (body) => ({
      asksAboutFuzzyStart: body.decision === "scope_error",
      noInventedStartOrTrip: body.request === null,
    }),
  },
];

if (cases.length > 10 || new Set(cases.map((testCase) => testCase.text)).size !== cases.length) {
  throw new Error("Acceptance set must contain no more than 10 distinct texts.");
}

if (!process.argv.includes("--run")) {
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        caseCount: cases.length,
        caseIds: cases.map((testCase) => testCase.id),
        message: "Pass --run to send at most one real provider request per case.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const caseArgument = process.argv.find((argument) => argument.startsWith("--case="));
const fromArgument = process.argv.find((argument) => argument.startsWith("--from="));
if (caseArgument && fromArgument) throw new Error("Use only one of --case or --from.");
const startIndex = fromArgument
  ? cases.findIndex((testCase) => testCase.id === fromArgument.slice("--from=".length))
  : 0;
if (startIndex < 0) throw new Error("Unknown --from ID.");
const selectedCases = caseArgument
  ? cases.filter((testCase) => testCase.id === caseArgument.slice("--case=".length))
  : cases.slice(startIndex);
if (selectedCases.length === 0) throw new Error("Unknown --case ID.");
const limit = limitArgument ? Number(limitArgument.slice("--limit=".length)) : selectedCases.length;
if (!Number.isInteger(limit) || limit < 1 || limit > selectedCases.length) {
  throw new Error("Invalid --limit; choose 1 through the case count.");
}

const summaries = [];
for (const testCase of selectedCases.slice(0, limit)) {
  let response;
  let body;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        text: testCase.text,
        locale: "zh-CN",
        datasetVersion,
      }),
      signal: AbortSignal.timeout(70_000),
    });
    body = await response.json();
  } catch {
    const summary = { id: testCase.id, transportFailure: true, passed: false };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
    break;
  }
  const checks = testCase.checks(body);
  const summary = {
    id: testCase.id,
    httpStatus: response.status,
    decision: body.decision ?? null,
    attemptedMode: body.parser?.attemptedMode ?? null,
    acceptedMode: body.parser?.acceptedMode ?? null,
    fallbackReasonCode: body.parser?.fallbackReasonCode ?? null,
    promptVersion: body.parser?.promptVersion ?? null,
    checks,
    passed:
      response.ok && body.parser?.acceptedMode === "llm" && Object.values(checks).every(Boolean),
  };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
  if (
    [401, 402, 403, 429].includes(response.status) ||
    ["auth_or_config", "rate_limited", "circuit_open"].includes(summary.fallbackReasonCode)
  )
    break;
}

console.log(
  JSON.stringify({
    sent: summaries.length,
    limit,
    passed: summaries.filter((summary) => summary.passed).length,
    stoppedEarly: summaries.length < limit,
  }),
);
if (summaries.length < limit || summaries.some((summary) => !summary.passed)) process.exitCode = 1;
