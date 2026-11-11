// k6 load test: `k6 run -e BASE_URL=https://your-preview.vercel.app -e SESSION=... loadtest/analyze.js`
//
// Not run as part of the build. 50 virtual users each upload the sample text
// contract and follow its progress, as the plan's launch check describes.
//
// Running it against the real model makes 4 AI calls per upload, so 50 uploads
// use 200 calls of the free daily quota: point it at a preview whose org has a
// small monthly token budget, or expect most analyses to fall back to the
// rule-based review. SESSION is a Clerk session cookie for a reviewer account
// in a test organisation.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    analyses: {
      executor: "per-vu-iterations",
      vus: 50,
      iterations: 1,
      maxDuration: "10m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    "http_req_duration{name:upload}": ["p(95)<5000"],
  },
};

const BASE = __ENV.BASE_URL;
const HEADERS = { Cookie: `__session=${__ENV.SESSION}` };
const TEXT = `SERVICE AGREEMENT

1. Term
This Agreement is valid for one year. Load test run ${Date.now()}.

2. Fees
The Client shall pay each invoice within 90 days of receipt.

3. Liability
The Client shall indemnify the Supplier against all claims, without limit.`;

export default function () {
  // A unique body per user, so duplicate detection does not short-circuit the test.
  const body = {
    file: http.file(`${TEXT}\nUser ${__VU}.`, `load-${__VU}.txt`, "text/plain"),
  };
  const upload = http.post(`${BASE}/api/contracts`, body, {
    headers: HEADERS,
    tags: { name: "upload" },
  });
  check(upload, { "upload accepted": (r) => r.status === 201 });
  const id = upload.json("id");
  if (!id) return;

  const started = Date.now();
  for (let i = 0; i < 60; i++) {
    sleep(5);
    const detail = http.get(`${BASE}/api/contracts/${id}`, {
      headers: HEADERS,
      tags: { name: "poll" },
    });
    const status = detail.json("contract.status");
    if (status === "ready" || status === "failed") {
      check(detail, { "analysed within 5 minutes": () => Date.now() - started < 300000 });
      return;
    }
  }
}
