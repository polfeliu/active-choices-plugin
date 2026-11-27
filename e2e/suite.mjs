import assert from 'node:assert/strict';

const PLUGIN_ID = 'uno-choice';
const CASES = [
  { parameterType: 'ChoiceParameter', widget: 'PT_SINGLE_SELECT', values: ['choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_MULTI_SELECT', values: ['choice-a', 'choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_RADIO', values: ['choice-b'] },
  { parameterType: 'ChoiceParameter', widget: 'PT_CHECKBOX', values: ['choice-a', 'choice-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_SINGLE_SELECT', values: ['south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_MULTI_SELECT', values: ['south-a', 'south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_RADIO', values: ['south-b'] },
  { parameterType: 'CascadeChoiceParameter', widget: 'PT_CHECKBOX', values: ['south-a', 'south-b'] },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_TEXT_BOX' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_ORDERED_LIST' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_UNORDERED_LIST' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_FORMATTED_HTML' },
  { parameterType: 'DynamicReferenceParameter', widget: 'ET_FORMATTED_HIDDEN_HTML' },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function encodeForm(entries) {
  return entries
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value).replaceAll('%20', '+')}`)
    .join('&');
}

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function groovyScript(script, fallback = "return ['FALLBACK']") {
  return `<script class="org.biouno.unochoice.model.GroovyScript">` +
    `<secureScript><script>${xml(script)}</script><sandbox>true</sandbox></secureScript>` +
    `<secureFallbackScript><script>${xml(fallback)}</script><sandbox>true</sandbox>` +
    `</secureFallbackScript></script>`;
}

function parameterXml({
  name,
  type,
  widget,
  script,
  omitValueField = false,
  filterable = false,
  filterLength = 1,
}) {
  const shared = `<name>${name}</name><description></description>` +
    `<randomName>e2e-${name.toLowerCase()}-${widget.toLowerCase()}</randomName>` +
    `<visibleItemCount>8</visibleItemCount>${groovyScript(script)}`;

  if (type === 'ChoiceParameter') {
    return `<org.biouno.unochoice.ChoiceParameter>${shared}` +
      `<choiceType>${widget}</choiceType><filterable>${filterable}</filterable>` +
      `<filterLength>${filterLength}</filterLength>` +
      `</org.biouno.unochoice.ChoiceParameter>`;
  }

  if (type === 'CascadeChoiceParameter') {
    return `<org.biouno.unochoice.CascadeChoiceParameter>${shared}` +
      `<parameters class="linked-hash-map"/>` +
      `<referencedParameters>PARENT</referencedParameters>` +
      `<computeDefaultFromReferences>true</computeDefaultFromReferences>` +
      `<choiceType>${widget}</choiceType><filterable>${filterable}</filterable>` +
      `<filterLength>${filterLength}</filterLength>` +
      `</org.biouno.unochoice.CascadeChoiceParameter>`;
  }

  assert.equal(type, 'DynamicReferenceParameter');
  return `<org.biouno.unochoice.DynamicReferenceParameter>${shared}` +
    `<parameters class="linked-hash-map"/>` +
    `<referencedParameters>PARENT</referencedParameters><choiceType>${widget}</choiceType>` +
    `<omitValueField>${omitValueField}</omitValueField>` +
    `<computeDefaultFromReferences>true</computeDefaultFromReferences>` +
    `</org.biouno.unochoice.DynamicReferenceParameter>`;
}

function fixtureConfig(definitions, command, authToken = '') {
  return `<?xml version="1.1" encoding="UTF-8"?><hudson.model.FreeStyleProject>` +
    `<actions/><description>Temporary Active Choices e2e fixture</description>` +
    `<keepDependencies>false</keepDependencies><authToken>${xml(authToken)}</authToken>` +
    `<properties><hudson.model.ParametersDefinitionProperty><parameterDefinitions>` +
    `${definitions.join('')}` +
    `</parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties>` +
    `<scm class="hudson.scm.NullSCM"/><canRoam>true</canRoam><disabled>false</disabled>` +
    `<blockBuildWhenDownstreamBuilding>false</blockBuildWhenDownstreamBuilding>` +
    `<blockBuildWhenUpstreamBuilding>false</blockBuildWhenUpstreamBuilding><triggers/>` +
    `<concurrentBuild>false</concurrentBuild><builders><hudson.tasks.Shell>` +
    `<command>${xml(command)}</command></hudson.tasks.Shell></builders><publishers/>` +
    `<buildWrappers/></hudson.model.FreeStyleProject>`;
}

function parentParameterXml() {
  return parameterXml({
    name: 'PARENT',
    type: 'ChoiceParameter',
    widget: 'PT_SINGLE_SELECT',
    script: "return ['north', 'south']",
  });
}

function standardScript(type) {
  return type === 'CascadeChoiceParameter'
    ? "return PARENT == 'south' ? ['south-a', 'south-b'] : ['north-a', 'north-b']"
    : "return ['choice-a', 'choice-b', 'choice-c']";
}

function referenceScript(widget) {
  if (widget === 'ET_TEXT_BOX') {
    return "return 'reference-display-' + PARENT";
  }
  if (widget === 'ET_ORDERED_LIST' || widget === 'ET_UNORDERED_LIST') {
    return "return ['reference-' + PARENT + '-one', 'reference-' + PARENT + '-two']";
  }
  return "return '<span>html-' + PARENT + '</span>' + " +
    "'<input type=\"hidden\" name=\"value\" value=\"html-value-' + PARENT + '\">'";
}

async function mustSucceed(response, description) {
  assert(response.ok(), `${description} returned HTTP ${response.status()}`);
  return response;
}

async function getCrumb(api, baseURL) {
  const response = await mustSucceed(
    await api.get(`${baseURL}/crumbIssuer/api/json`),
    'crumb request',
  );
  return response.json();
}

async function createJob(api, baseURL, name, definitions, command, authToken = '') {
  const crumb = await getCrumb(api, baseURL);
  const response = await api.post(`${baseURL}/createItem?name=${encodeURIComponent(name)}`, {
    headers: {
      'Content-Type': 'application/xml',
      [crumb.crumbRequestField]: crumb.crumb,
    },
    data: fixtureConfig(definitions, command, authToken),
  });
  assert.equal(response.status(), 200, `could not create fixture ${name}`);
}

async function deleteJob(api, baseURL, name) {
  const crumb = await getCrumb(api, baseURL);
  const response = await api.post(`${baseURL}/job/${encodeURIComponent(name)}/doDelete`, {
    headers: { [crumb.crumbRequestField]: crumb.crumb },
  });
  assert([200, 302, 404].includes(response.status()), `could not delete fixture ${name}`);
}

async function buildNumbers(api, baseURL, name) {
  const response = await mustSucceed(
    await api.get(`${baseURL}/job/${encodeURIComponent(name)}/api/json?tree=builds[number,queueId]`),
    `build list for ${name}`,
  );
  const body = await response.json();
  return body.builds.map((build) => build.number);
}

async function waitForBuild(api, baseURL, name, { previousNumbers = [], queueId } = {}) {
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

async function apiBuild(api, baseURL, name, fields) {
  const crumb = await getCrumb(api, baseURL);
  const before = await buildNumbers(api, baseURL, name);
  const form = Object.fromEntries(fields.map(([key, value]) => [key, value]));
  for (const key of new Set(fields.map(([fieldName]) => fieldName))) {
    const values = fields.filter(([fieldName]) => fieldName === key).map(([, value]) => value);
    form[key] = values.join(',');
  }
  const response = await api.post(
    `${baseURL}/job/${encodeURIComponent(name)}/buildWithParameters`,
    {
      headers: { [crumb.crumbRequestField]: crumb.crumb },
      form,
    },
  );
  if (![200, 201].includes(response.status())) {
    const body = await response.text();
    const message = body.match(/<title>([^<]+)<\/title>|<h2>([^<]+)<\/h2>/)?.slice(1).find(Boolean);
    const detail = body.replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700);
    throw new Error(`API build returned HTTP ${response.status()}${message ? `: ${message}` : ''}; ${detail}`);
  }
  const location = response.headers().location;
  assert(location, 'API build response did not include its queue item');
  const queueMatch = location.match(/\/queue\/item\/(\d+)/);
  assert(queueMatch, `could not parse queue id from ${location}`);
  const queueId = Number(queueMatch[1]);
  const queueURL = new URL(location, baseURL).toString();
  return waitForQueueItem(api, baseURL, name, queueURL, queueId, before);
}

async function waitForQueueItem(api, baseURL, name, queueURL, queueId, previousNumbers = []) {
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
      return waitForBuild(api, baseURL, name, { previousNumbers: before, queueId });
    }
    await sleep(400);
  }
  throw new Error(`timed out waiting for queue item ${queueId}`);
}

async function webhookBuild(page, api, baseURL, name, token, fields) {
  const body = encodeForm([['token', token], ...fields]);
  const response = await page.evaluate(async ({ url, body }) => {
    const result = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { status: result.status, location: result.headers.get('Location') };
  }, {
    url: `${baseURL}/buildByToken/buildWithParameters?job=${encodeURIComponent(name)}`,
    body,
  });
  assert([201, 303].includes(response.status),
    `Build Token Root request returned HTTP ${response.status}`);
  assert(response.location, 'Build Token Root response did not include its queue item');
  const queueMatch = response.location.match(/\/queue\/item\/(\d+)/);
  assert(queueMatch, 'could not parse the webhook queue id');
  return waitForQueueItem(
    api,
    baseURL,
    name,
    new URL(response.location, baseURL).toString(),
    Number(queueMatch[1]),
  );
}

function parameterGroup(page, name) {
  return page.locator('div[name="parameter"]').filter({
    has: page.locator(`input[name="name"][value="${name}"]`),
  });
}

async function chooseValues(group, name, widget, values) {
  if (widget === 'PT_SINGLE_SELECT' || widget === 'PT_MULTI_SELECT') {
    const selector = group.locator('select[name="value"]');
    await selector.selectOption(values);
    return;
  }
  const type = widget === 'PT_RADIO' ? 'radio' : 'checkbox';
  for (const value of values) {
    const control = group.locator(`input[type="${type}"][value="${value}"]`);
    await control.locator('xpath=following-sibling::label[1]').click();
  }
}

async function waitForParentRefresh(page, name, widget) {
  await page.waitForFunction(({ parameterName, choiceType }) => {
    const root = [...document.querySelectorAll('div[name="parameter"]')].find(
      (element) => element.querySelector('input[name="name"]')?.value === parameterName,
    );
    let options;
    if (choiceType === 'PT_SINGLE_SELECT' || choiceType === 'PT_MULTI_SELECT') {
      options = [...(root?.querySelectorAll('select[name="value"] option') ?? [])]
        .map((option) => option.value);
    } else if (choiceType === 'PT_RADIO') {
      options = [...(root?.querySelectorAll('input[type="radio"]') ?? [])]
        .map((input) => input.value);
    } else {
      options = [...(root?.querySelectorAll('input[type="checkbox"]') ?? [])]
        .map((input) => input.value);
    }
    return options.includes('south-a') && options.includes('south-b') && !options.includes('north-a');
  }, { parameterName: name, choiceType: widget });
}

async function waitForReferenceRefresh(page, widget) {
  await page.waitForFunction((choiceType) => {
    const root = [...document.querySelectorAll('div[name="parameter"]')].find(
      (element) => element.querySelector('input[name="name"]')?.value === 'CHILD',
    );
    if (!root) return false;
    if (choiceType === 'ET_TEXT_BOX') {
      return root.querySelector('input[id^="inputElement_"]')?.value ===
        '"reference-display-south"';
    }
    if (choiceType === 'ET_ORDERED_LIST' || choiceType === 'ET_UNORDERED_LIST') {
      const items = [...root.querySelectorAll('li')].map((item) => item.textContent.trim());
      return JSON.stringify(items) === JSON.stringify(['reference-south-one', 'reference-south-two']);
    }
    const markup = root.querySelector('[id^="formattedHtml_"]');
    return markup?.textContent.includes('html-south') &&
      markup.querySelector('input[name="value"]')?.value === 'html-value-south';
  }, widget);
}

async function uiBuild(page, api, baseURL, name, {
  parent,
  parameterName,
  widget,
  values,
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
  }

  if (parameterName && widget && values) {
    await chooseValues(parameterGroup(page, parameterName), parameterName, widget, values);
  }

  const submit = page.getByRole('button', { name: /^Build$/ });
  assert.equal(await submit.count(), 1, `Build button missing on ${name}`);
  await submit.click();
  return waitForBuild(api, baseURL, name, { previousNumbers: before });
}

function expectedApiReference(widget) {
  if (widget === 'ET_ORDERED_LIST' || widget === 'ET_UNORDERED_LIST') {
    return 'reference-south-one';
  }
  return '';
}

async function verifyPlugin(api, baseURL, expectedVersion) {
  const response = await mustSucceed(
    await api.get(`${baseURL}/pluginManager/api/json?tree=plugins[shortName,version,active]`),
    'plugin version check',
  );
  const body = await response.json();
  const plugin = body.plugins.find((item) => item.shortName === PLUGIN_ID);
  assert(plugin, `${PLUGIN_ID} is not installed`);
  assert.equal(plugin.active, true, `${PLUGIN_ID} is inactive`);
  assert.equal(plugin.version, expectedVersion, 'installed plugin version does not match the expected build');
  return plugin.version;
}

export async function runActiveChoicesSuite(page, api, { baseURL, expectedVersion }) {
  assert(baseURL, 'baseURL is required');
  assert(expectedVersion, 'expectedVersion is required');
  const version = await verifyPlugin(api, baseURL, expectedVersion);
  const prefix = `ac-e2e-${Date.now().toString(36)}`;
  const fixtures = [];
  const results = [];
  const failures = [];

  try {
    for (const [index, scenario] of CASES.entries()) {
      const name = `${prefix}-${index + 1}`;
      const isReactive = scenario.parameterType === 'CascadeChoiceParameter';
      const isReference = scenario.parameterType === 'DynamicReferenceParameter';
      const parameterName = isReactive || isReference ? 'CHILD' : 'VALUE';
      const definitions = [];
      if (isReactive || isReference) definitions.push(parentParameterXml());

      const script = isReference
        ? referenceScript(scenario.widget)
        : standardScript(scenario.parameterType);
      definitions.push(parameterXml({
        name: parameterName,
        type: scenario.parameterType,
        widget: scenario.widget,
        script,
        omitValueField: isReference && scenario.widget.startsWith('ET_FORMATTED'),
      }));
      await createJob(api, baseURL, name, definitions, `echo E2E_${parameterName}=$${parameterName}`);
      fixtures.push(name);

      try {
        let ui;
        let apiResult;
        const uiSurface = isReference
          ? () => uiBuild(page, api, baseURL, name, {
            parent: 'south', widget: scenario.widget, reference: true,
          })
          : () => uiBuild(page, api, baseURL, name, {
            parent: isReactive ? 'south' : undefined,
            parameterName,
            widget: scenario.widget,
            values: scenario.values,
          });
        try {
          ui = await uiSurface();
        } catch (error) {
          failures.push({ parameterType: scenario.parameterType, widget: scenario.widget,
            surface: 'UI', error: error.message });
        }

        const apiFields = isReference
          ? [['PARENT', 'south']]
          : [...(isReactive ? [['PARENT', 'south']] : []),
            ...scenario.values.map((value) => [parameterName, value])];
        try {
          apiResult = await apiBuild(api, baseURL, name, apiFields);
        } catch (error) {
          failures.push({ parameterType: scenario.parameterType, widget: scenario.widget,
            surface: 'API', error: error.message });
        }

        if (ui && apiResult) {
          if (isReference) {
            const expectedUi = scenario.widget.startsWith('ET_FORMATTED')
              ? 'html-value-south' : '';
            const expectedApi = expectedApiReference(scenario.widget);
            try {
              assert.equal(ui.parameters.CHILD, expectedUi,
                `${scenario.widget} UI submitted value`);
              assert.equal(apiResult.parameters.CHILD, expectedApi,
                `${scenario.widget} API default`);
            } catch (error) {
              failures.push({ parameterType: scenario.parameterType, widget: scenario.widget,
                surface: 'value assertion', error: error.message });
            }
            results.push({ parameterType: scenario.parameterType, widget: scenario.widget,
              ui: ui.parameters.CHILD, api: apiResult.parameters.CHILD,
              equivalent: ui.parameters.CHILD === apiResult.parameters.CHILD,
              expectedDifference: ui.parameters.CHILD !== apiResult.parameters.CHILD });
          } else {
            try {
              assert.equal(ui.parameters[parameterName], apiResult.parameters[parameterName],
                `${scenario.parameterType}/${scenario.widget} UI and API values differ`);
              assert.equal(ui.parameters[parameterName], scenario.values.join(','),
                `${scenario.parameterType}/${scenario.widget} did not store selected values`);
              if (isReactive) {
                assert.equal(ui.parameters.PARENT, 'south', 'UI parent value mismatch');
                assert.equal(apiResult.parameters.PARENT, 'south', 'API parent value mismatch');
              }
            } catch (error) {
              failures.push({ parameterType: scenario.parameterType, widget: scenario.widget,
                surface: 'equivalence assertion', error: error.message });
            }
            results.push({ parameterType: scenario.parameterType, widget: scenario.widget,
              ui: ui.parameters[parameterName], api: apiResult.parameters[parameterName],
              equivalent: ui.parameters[parameterName] === apiResult.parameters[parameterName] });
          }
        } else {
          results.push({
            parameterType: scenario.parameterType,
            widget: scenario.widget,
            ui: ui ? ui.parameters[parameterName] : null,
            api: apiResult ? apiResult.parameters[parameterName] : null,
            equivalent: false,
          });
        }
      } catch (error) {
        failures.push({
          parameterType: scenario.parameterType,
          widget: scenario.widget,
          error: error.message,
        });
      }
    }

    const defaultName = `${prefix}-cascade-default`;
    const parent = parentParameterXml();
    const child = parameterXml({
      name: 'CHILD',
      type: 'CascadeChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      script: "return PARENT == 'south' ? ['south-default', 'south-alternate'] : ['north-default']",
    });
    const grandchild = parameterXml({
      name: 'GRANDCHILD',
      type: 'CascadeChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      script: "return [CHILD + '-grandchild']",
    }).replace('<referencedParameters>PARENT</referencedParameters>',
      '<referencedParameters>CHILD</referencedParameters>');
    await createJob(api, baseURL, defaultName, [parent, child, grandchild],
      'echo E2E_PARENT=$PARENT E2E_CHILD=$CHILD E2E_GRANDCHILD=$GRANDCHILD');
    fixtures.push(defaultName);

    try {
    const uiDefaults = await uiBuild(page, api, baseURL, defaultName, { parent: 'south' });
    const apiDefaults = await apiBuild(api, baseURL, defaultName, [['PARENT', 'south']]);
    for (const [label, build] of [['UI', uiDefaults], ['API', apiDefaults]]) {
      assert.equal(build.parameters.PARENT, 'south', `${label} cascade parent`);
      assert.equal(build.parameters.CHILD, 'south-default', `${label} omitted child default`);
      assert.equal(build.parameters.GRANDCHILD, 'south-default-grandchild', `${label} chained default`);
    }
    assert.deepEqual(uiDefaults.parameters, apiDefaults.parameters,
      'UI and API cascade default parameter maps differ');
    results.push({
      parameterType: 'CascadeChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      case: 'omitted child and chained defaults',
      ui: uiDefaults.parameters,
      api: apiDefaults.parameters,
      equivalent: true,
    });
    } catch (error) {
      failures.push({ case: 'cascade omitted child and chained defaults', error: error.message });
    }

    const webhookName = `${prefix}-webhook`;
    const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const webhookToken = `e2e-${nonce}`;
    const webhookChild = parameterXml({
      name: 'CHILD',
      type: 'CascadeChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      script: "return PARENT == 'south' ? ['south-child'] : ['north-child']",
    }).replace(
      '<secureFallbackScript><script>return [&apos;FALLBACK&apos;]</script>',
      '<secureFallbackScript><script>return [&apos;WEBHOOK_FALLBACK&apos;]</script>',
    );
    await createJob(
      api,
      baseURL,
      webhookName,
      [parentParameterXml(), webhookChild],
      'echo WEBHOOK_PARENT=$PARENT WEBHOOK_CHILD=$CHILD',
      webhookToken,
    );
    fixtures.push(webhookName);
    try {
    const webhookResult = await webhookBuild(
      page,
      api,
      baseURL,
      webhookName,
      webhookToken,
      [['PARENT', 'south']],
    );
    assert.equal(webhookResult.parameters.PARENT, 'south', 'webhook parent value was not recorded');
    assert.equal(
      webhookResult.parameters.CHILD,
      'WEBHOOK_FALLBACK',
      'anonymous webhook trigger should keep the old fallback default',
    );
    results.push({
      surface: 'Build Authorization Token Root webhook-style POST',
      parameterType: 'CascadeChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      input: { PARENT: 'south' },
      result: webhookResult.parameters,
      expectedChild: 'WEBHOOK_FALLBACK',
      equivalent: false,
    });
    } catch (error) {
      failures.push({ case: 'Build Authorization Token Root webhook-style POST', error: error.message });
    }

    const mapName = `${prefix}-map-options`;
    const mapChoice = parameterXml({
      name: 'VALUE',
      type: 'ChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      script: "return ['key-a': 'Alpha', 'key-b': 'Beta:selected', 'key-disabled': 'Gamma:disabled']",
      filterable: true,
      filterLength: 2,
    });
    await createJob(api, baseURL, mapName, [mapChoice], 'echo E2E_VALUE=$VALUE');
    fixtures.push(mapName);
    try {
    await page.goto(`${baseURL}/job/${encodeURIComponent(mapName)}/build?delay=0sec`);
    const mapGroup = parameterGroup(page, 'VALUE');
    const mapSelect = mapGroup.locator('select[name="value"]');
    assert.deepEqual(
      await mapSelect.locator('option').evaluateAll((options) =>
        options.map((option) => [option.value, option.textContent, option.disabled])),
      [
        ['key-a', 'Alpha', false],
        ['key-b', 'Beta', false],
        ['key-disabled', 'Gamma', true],
      ],
      'map choice labels, keys, or disabled marker changed',
    );
    assert.equal(await mapSelect.inputValue(), 'key-b', 'selected marker was not applied');
    const filter = mapGroup.locator('input.uno_choice_filter');
    await filter.pressSequentially('gamma');
    await page.waitForFunction(() => {
      const options = [...document.querySelectorAll('div[name="parameter"] select[name="value"] option')];
      return options.length === 1 && options[0].value === 'key-disabled';
    });
    await filter.fill('');
    await filter.press('End');
    await page.waitForFunction(() =>
      document.querySelectorAll('div[name="parameter"] select[name="value"] option').length === 3);
    await mapSelect.selectOption('key-a');
    const mapUi = await (async () => {
      const before = await buildNumbers(api, baseURL, mapName);
      await page.getByRole('button', { name: /^Build$/ }).click();
      return waitForBuild(api, baseURL, mapName, { previousNumbers: before });
    })();
    const mapApi = await apiBuild(api, baseURL, mapName, [['VALUE', 'key-a']]);
    const mapDefault = await apiBuild(api, baseURL, mapName, []);
    assert.equal(mapUi.parameters.VALUE, 'key-a', 'UI submitted the map label instead of its key');
    assert.equal(mapApi.parameters.VALUE, 'key-a', 'API did not preserve the submitted map key');
    assert.equal(mapDefault.parameters.VALUE, 'key-b', 'API did not use the marked default key');
    results.push({
      parameterType: 'ChoiceParameter',
      widget: 'PT_SINGLE_SELECT',
      case: 'map labels, selected/disabled markers, and filter',
      ui: mapUi.parameters.VALUE,
      api: mapApi.parameters.VALUE,
      apiDefault: mapDefault.parameters.VALUE,
      equivalent: mapUi.parameters.VALUE === mapApi.parameters.VALUE,
    });
    } catch (error) {
      failures.push({ case: 'map labels, selected/disabled markers, and filter', error: error.message });
    }

    return { pluginVersion: version, scenarios: results, failures, count: results.length };
  } finally {
    const cleanupErrors = [];
    for (const name of fixtures.reverse()) {
      try {
        await deleteJob(api, baseURL, name);
      } catch (error) {
        cleanupErrors.push(`${name}: ${error.message}`);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors.map((message) => new Error(message)),
        'one or more temporary Jenkins jobs could not be deleted');
    }
  }
}

export { CASES };
