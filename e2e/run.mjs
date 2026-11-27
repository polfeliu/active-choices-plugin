import assert from 'node:assert/strict';
import { chromium, request } from 'playwright';
import { runActiveChoicesSuite } from './suite.mjs';

const baseURL = process.env.JENKINS_URL?.replace(/\/+$/, '');
const username = process.env.JENKINS_USER;
const token = process.env.JENKINS_API_TOKEN;
const expectedVersion = process.env.JENKINS_EXPECTED_PLUGIN_VERSION;

for (const [name, value] of Object.entries({ baseURL, username, token, expectedVersion })) {
  assert(value, `${name} must be set in the environment`);
}

const origin = new URL(baseURL).origin;
const credentials = {
  username,
  password: token,
  origin,
  send: 'always',
};
const api = await request.newContext({ baseURL, httpCredentials: credentials });
const anonymousApi = await request.newContext({ baseURL, maxRedirects: 0 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const authorization = `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
await context.route('**/*', async (route) => {
  if (new URL(route.request().url()).origin !== origin) {
    await route.continue();
    return;
  }
  await route.continue({
    headers: { ...route.request().headers(), authorization },
  });
});
const page = await context.newPage();

try {
  const apiIdentityResponse = await api.get(`${baseURL}/whoAmI/api/json?tree=name,anonymous`);
  assert.equal(apiIdentityResponse.status(), 200,
    `API authentication returned HTTP ${apiIdentityResponse.status()}`);
  const apiIdentity = await apiIdentityResponse.json();
  assert.equal(apiIdentity.anonymous, false, 'API context is anonymous');
  assert.equal(apiIdentity.name, username, 'API context authenticated as the wrong Jenkins user');

  await page.goto(`${baseURL}/whoAmI/api/json?tree=name,anonymous`);
  const browserIdentity = JSON.parse(await page.locator('body').innerText());
  assert.equal(browserIdentity.anonymous, false, 'browser context is anonymous');
  assert.equal(browserIdentity.name, apiIdentity.name,
    'browser and API contexts authenticated as different Jenkins users');

  const report = await runActiveChoicesSuite(page, api, {
    anonymousApi,
    baseURL,
    expectedVersion,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await anonymousApi.dispose();
  await api.dispose();
}
