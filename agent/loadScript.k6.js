// The k6 script behind every AgentQA load test (agent/loadRunner.mjs). The request and the load
// shape come from a JSON file the worker writes for each run, so nothing a user typed is ever code.
import http from 'k6/http';

const config = JSON.parse(open(__ENV.AGENTQA_CONFIG));
const { method, url, body, headers } = config.request;

export const options = config.options;

export default function () {
  http.request(method, url, body, { headers, tags: { name: 'request' } });
}

// The worker reads the end-of-test numbers from this file.
export function handleSummary(data) {
  return { [config.summaryPath]: JSON.stringify(data) };
}
