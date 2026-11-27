import assert from 'node:assert/strict';

// Jenkins exposes queue/build state through JSON polling, not a completion event.
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mustSucceed(response, description) {
  assert(response.ok(), `${description} returned HTTP ${response.status()}`);
  return response;
}

export async function buildNumbers(api, baseURL, name) {
  const response = await mustSucceed(
    await api.get(`${baseURL}/job/${encodeURIComponent(name)}/api/json?tree=builds[number,queueId]`),
    `build list for ${name}`,
  );
  const body = await response.json();
  return body.builds.map((build) => build.number);
}

export async function waitForBuild(api, baseURL, name, { previousNumbers = [], queueId } = {}) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await api.get(
      `${baseURL}/job/${encodeURIComponent(name)}/api/json?tree=builds[number,queueId,result,building,actions[parameters[name,value]]]`,
    );
    if (response.ok()) {
      const { builds } = await response.json();
      const build = builds.find((candidate) => queueId !== undefined
        ? candidate.queueId === queueId
        : !previousNumbers.includes(candidate.number));
      if (build && !build.building) {
        assert.equal(build.result, 'SUCCESS', `${name} #${build.number} did not succeed`);
        const actions = build.actions.find((action) => action.parameters);
        const parameters = Object.fromEntries(
          (actions?.parameters ?? []).map(({ name: parameterName, value }) => [parameterName, value]),
        );
        return { number: build.number, queueId: build.queueId, parameters };
      }
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for a build of ${name}`);
}

async function waitForQueueItem(api, baseURL, name, queueURL, queueId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const queueResponse = await api.get(`${queueURL.replace(/\/$/, '')}/api/json`);
    if (queueResponse.ok()) {
      const queueItem = await queueResponse.json();
      if (queueItem.cancelled) throw new Error(`queue item ${queueId} was cancelled`);
      if (queueItem.executable?.number !== undefined) {
        return waitForBuild(api, baseURL, name, { queueId });
      }
    } else if (queueResponse.status() === 404) {
      return waitForBuild(api, baseURL, name, { queueId });
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for queue item ${queueId}`);
}

export async function apiBuild(api, baseURL, name, fields) {
  const crumbResponse = await mustSucceed(
    await api.get(`${baseURL}/crumbIssuer/api/json`),
    'crumb request',
  );
  const crumb = await crumbResponse.json();
  const form = Object.fromEntries(
    [...new Set(fields.map(([fieldName]) => fieldName))].map((fieldName) => [
      fieldName,
      fields.filter(([name]) => name === fieldName).map(([, value]) => value).join(','),
    ]),
  );
  const response = await api.post(
    `${baseURL}/job/${encodeURIComponent(name)}/buildWithParameters`,
    {
      headers: { [crumb.crumbRequestField]: crumb.crumb },
      form,
      maxRedirects: 0,
    },
  );
  assert([200, 201].includes(response.status()),
    `API build returned HTTP ${response.status()}`);
  const location = response.headers().location;
  assert(location, 'API build response did not include its queue item');
  const queueMatch = location.match(/\/queue\/item\/(\d+)/);
  assert(queueMatch, `could not parse queue id from ${location}`);
  const queueId = Number(queueMatch[1]);
  return waitForQueueItem(api, baseURL, name, new URL(location, baseURL).toString(), queueId);
}

export async function webhookBuild(anonymousApi, authenticatedApi, baseURL, name, token, fields) {
  const form = Object.fromEntries([['token', token], ...fields]);
  const response = await anonymousApi.post(
    `${baseURL}/buildByToken/buildWithParameters?job=${encodeURIComponent(name)}`,
    { form, maxRedirects: 0 },
  );
  assert([201, 303].includes(response.status()),
    `Build Token Root request returned HTTP ${response.status()}`);
  const location = response.headers().location;
  assert(location, 'Build Token Root response did not include its queue item');
  const queueMatch = location.match(/\/queue\/item\/(\d+)/);
  assert(queueMatch, 'could not parse the webhook queue id');
  const queueId = Number(queueMatch[1]);
  return waitForQueueItem(
    authenticatedApi,
    baseURL,
    name,
    new URL(location, baseURL).toString(),
    queueId,
  );
}

function parameterGroup(page, name) {
  return page.locator('div[name="parameter"]').filter({
    has: page.locator(`input[name="name"][value="${name}"]`),
  });
}

async function waitForParentRefresh(page, name, widget) {
  await page.waitForFunction(({ parameterName, choiceType }) => {
    const root = [...document.querySelectorAll('div[name="parameter"]')].find(
      (element) => element.querySelector('input[name="name"]')?.value === parameterName,
    );
    let values;
    if (choiceType === 'PT_SINGLE_SELECT' || choiceType === 'PT_MULTI_SELECT') {
      values = [...(root?.querySelectorAll('select[name="value"] option') ?? [])]
        .map((option) => option.value);
    } else {
      const inputType = choiceType === 'PT_RADIO' ? 'radio' : 'checkbox';
      values = [...(root?.querySelectorAll(`input[type="${inputType}"]`) ?? [])]
        .map((input) => input.value);
    }
    const normalized = values
      .map((value) => value.replace(/:(?:selected|disabled)(?::(?:selected|disabled))*$/, ''))
      .sort();
    return JSON.stringify(normalized) === JSON.stringify(['south-a', 'south-b']);
  }, { parameterName: name, choiceType: widget });
}

async function waitForWidgetDefaults(page, expectedParameters) {
  await page.waitForFunction((expected) => Object.entries(expected).every(([name, values]) => {
    const root = [...document.querySelectorAll('div[name="parameter"]')].find(
      (element) => element.querySelector('input[name="name"]')?.value === name,
    );
    if (!root) return false;
    const select = root.querySelector('select[name="value"]');
    const actual = select
      ? [...select.selectedOptions].map((option) => option.value)
      : [...root.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')]
        .map((input) => input.value);
    return JSON.stringify(actual) === JSON.stringify(values);
  }), expectedParameters);
}

async function waitForReferenceRefresh(page, widget) {
  await page.waitForFunction((choiceType) => {
    const root = [...document.querySelectorAll('div[name="parameter"]')].find(
      (element) => element.querySelector('input[name="name"]')?.value === 'CHILD',
    );
    if (!root) return false;
    if (choiceType === 'ET_TEXT_BOX') {
      return root.querySelector('input[id^="inputElement_"]')?.value
        .includes('reference-display-south');
    }
    if (choiceType === 'ET_ORDERED_LIST') {
      return root.querySelector('ol')?.textContent.includes('reference-south-two') &&
        !root.querySelector('ul');
    }
    if (choiceType === 'ET_UNORDERED_LIST') {
      return root.querySelector('ul')?.textContent.includes('reference-south-two') &&
        !root.querySelector('ol');
    }
    const markup = root.querySelector('[id^="formattedHtml_"]');
    return markup?.textContent.includes('html-south') &&
      markup.querySelector('input[name="value"]')?.value === 'html-value-south';
  }, widget);
}

export async function uiBuild(page, api, baseURL, name, {
  parent,
  parameterName,
  widget,
  values,
  expectedParameters,
  reference = false,
}) {
  const before = await buildNumbers(api, baseURL, name);
  await page.goto(`${baseURL}/job/${encodeURIComponent(name)}/build?delay=0sec`);

  if (parent !== undefined) {
    const parentGroup = parameterGroup(page, 'PARENT');
    await parentGroup.locator('select[name="value"]').selectOption(parent);
    if (parameterName === 'CHILD' && !reference) {
      await waitForParentRefresh(page, parameterName, widget);
    }
    if (reference) await waitForReferenceRefresh(page, widget);
    if (expectedParameters) await waitForWidgetDefaults(page, expectedParameters);
  } else if (expectedParameters) {
    await waitForWidgetDefaults(page, expectedParameters);
  }

  if (parameterName && widget) {
    const group = parameterGroup(page, parameterName);
    if (widget === 'PT_SINGLE_SELECT' || widget === 'PT_MULTI_SELECT') {
      const selector = group.locator('select[name="value"]');
      assert.equal(await selector.evaluate((element) => element.multiple),
        widget === 'PT_MULTI_SELECT', `${widget} did not render the expected select type`);
    } else if (widget === 'PT_RADIO' || widget === 'PT_CHECKBOX') {
      const type = widget === 'PT_RADIO' ? 'radio' : 'checkbox';
      const expected = parameterName === 'VALUE'
        ? ['choice-a', 'choice-b', 'choice-c']
        : ['south-a', 'south-b'];
      const actual = await group.locator(`input[type="${type}"]`)
        .evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.deepEqual(actual, expected, `${widget} rendered the wrong controls`);
    } else if (widget.startsWith('ET_')) {
      if (widget === 'ET_TEXT_BOX') {
        const input = group.locator('input[id^="inputElement_"]');
        assert.equal(await input.getAttribute('readonly'), 'readonly', 'reference text box is not read-only');
        assert.equal(await input.isDisabled(), true, 'reference text box is not disabled');
      } else if (widget === 'ET_ORDERED_LIST') {
        assert.equal(await group.locator('ol').count(), 1, 'ordered list did not render an ol element');
      } else if (widget === 'ET_UNORDERED_LIST') {
        assert.equal(await group.locator('ul').count(), 1, 'unordered list did not render a ul element');
      } else {
        const visible = widget === 'ET_FORMATTED_HTML';
        assert.equal(await group.isVisible(), visible,
          `${widget} visibility did not match its type`);
      }
    }
  }

  if (parameterName && widget && values) {
    await chooseValues(parameterGroup(page, parameterName), widget, values);
  }

  const submit = page.getByRole('button', { name: /^Build$/ });
  assert.equal(await submit.count(), 1, `Build button missing on ${name}`);
  await submit.click();
  return waitForBuild(api, baseURL, name, { previousNumbers: before });
}

async function chooseValues(group, widget, values) {
  if (widget === 'PT_SINGLE_SELECT' || widget === 'PT_MULTI_SELECT') {
    await group.locator('select[name="value"]').selectOption(values);
    return;
  }
  const type = widget === 'PT_RADIO' ? 'radio' : 'checkbox';
  for (const value of values) {
    const control = group.locator(`input[type="${type}"][value="${value}"]`);
    if (await control.isChecked()) continue;
    await control.locator('xpath=following-sibling::label[1]').click();
  }
}
