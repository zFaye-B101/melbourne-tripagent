const endpoint = process.env.TRIPAGENT_BFF_URL ?? "http://localhost:8787/v1/trip-requests/parse";

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "http://localhost:3000",
  },
  body: JSON.stringify({
    text: "墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE",
    locale: "zh-CN",
    datasetVersion: "mel-poi-v0.1-2026-09-14",
  }),
});

const payload = await response.json();
const summary = {
  httpStatus: response.status,
  decision: payload.decision,
  attemptedMode: payload.parser?.attemptedMode,
  acceptedMode: payload.parser?.acceptedMode,
  fallbackReasonCode: payload.parser?.fallbackReasonCode,
  promptVersion: payload.parser?.promptVersion,
  evidencePaths: Object.fromEntries(
    [
      "/destination/text",
      "/destination/supportedCity",
      "/geography/scope",
      "/geography/strength",
    ].map((path) => [
      path,
      Array.isArray(payload.fieldEvidence) &&
        payload.fieldEvidence.some((item) => item?.path === path),
    ]),
  ),
};

console.log(JSON.stringify(summary, null, 2));

if (
  !response.ok ||
  summary.attemptedMode !== "llm" ||
  summary.acceptedMode !== "llm" ||
  Object.values(summary.evidencePaths).some((present) => !present)
) {
  process.exitCode = 1;
}
