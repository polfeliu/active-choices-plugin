# Live Active Choices regression harness

This opt-in suite checks the plugin installed in a real Jenkins controller. It
drives the Build with Parameters form with Playwright, submits equivalent
`buildWithParameters` requests through Jenkins' API, and compares the recorded
build parameters. It covers all 13 parameter/widget combinations exposed by
this plugin revision.

For Choice and Cascade Choice widgets, the suite compares all recorded
parameters from the UI and API builds, including parent values and computed
defaults. Reactive Reference widgets have documented surface-specific values:
the UI renders reference content and may submit a value-bearing HTML input,
while the API does not render that HTML. Each surface is checked against its
own expected value, and the report records any expected UI/API difference.

## Run against a test controller

Use a Jenkins account that can read plugins and create, configure, build, and
delete jobs. Provide a Jenkins API token through the environment; never put it
in this directory or on a command line.

```sh
cd e2e
npm ci
npx playwright install chromium
JENKINS_URL=https://jenkins.example.test \
JENKINS_USER=e2e-user \
JENKINS_API_TOKEN="$JENKINS_API_TOKEN" \
JENKINS_EXPECTED_PLUGIN_VERSION=2.8.12-rc1516.6ea_e25cc8101 \
npm test
```

The runner verifies that both authenticated contexts identify as the requested
Jenkins user before creating jobs. API credentials are restricted to the
configured Jenkins origin. Webhook requests use a separate unauthenticated
request context. The suite checks the installed `uno-choice` version before
creating jobs, uses uniquely named fixtures, and verifies deletion in a
`finally` block. Reports include build and queue IDs, parameter values, and
fixture names, never authentication headers or trigger tokens.

## What it checks

- Choice and Cascade Choice: single select, multi-select, radio, and checkbox.
- Reactive Reference: read-only text box, ordered list, unordered list,
  formatted HTML, and formatted hidden HTML.
- UI/API parity for selector values and map defaults, including stored map keys
  rather than display labels.
- Cascading parent updates and API computed defaults when the child is omitted
  for single-select, multi-select, radio, and checkbox widgets.
- An option-off control to verify that reference-based defaults remain opt-in.
- Reference display refresh, HTML value submission, and expected server-side
  default differences.
- Anonymous Build Authorization Token Root requests used as inbound webhook-style
  triggers, separately checking that anonymous standard builds are rejected and
  token-root requests retain the fallback default.
- Rendered element type, selected values, text-box read-only state, and visible
  versus hidden HTML behavior.

This suite does not grant Jenkins Script Approval. The copied/renamed-job
identity behavior that needs access to `jenkinsProject` is covered by the
plugin's isolated JenkinsRule tests, where approvals are scoped to the test.
It tests the installed Build Authorization Token Root endpoint; it cannot test
SCM-specific webhook payload mappings because this controller has no SCM
webhook plugin installed. Pipeline and CLI trigger paths remain covered by the
plugin's JenkinsRule tests rather than this live-controller suite.
