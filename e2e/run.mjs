import assert from 'node:assert/strict';
import { chromium, request } from 'playwright';
import { runActiveChoicesSuite } from './suite.mjs';

const baseURL = process.env.JENKINS_URL;
const username = process.env.JENKINS_USER;
const token = process.env.JENKINS_API_TOKEN;
const expectedVersion = process.env.JENKINS_EXPECTED_PLUGIN_VERSION;

for (const [name, value] of Object.entries({ baseURL, username, token, expectedVersion })) {
  assert(value, `${name} must be set in the environment`);
}

const credentials = { username, password: token };
const api = await request.newContext({ baseURL, httpCredentials: credentials });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ httpCredentials: credentials });
const page = await context.newPage();

try {
  await page.goto(baseURL);
  const report = await runActiveChoicesSuite(page, api, {
    baseURL,
    expectedVersion,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await api.dispose();
}
