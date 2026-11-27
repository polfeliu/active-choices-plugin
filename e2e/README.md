# Live Active Choices regression harness

This opt-in suite checks the plugin installed in a real Jenkins controller. It
drives the Build with Parameters form with Playwright, submits equivalent
`buildWithParameters` requests through Jenkins' API, and compares the recorded
build parameters. It covers all 13 parameter/widget combinations exposed by
this plugin revision.

The two paths are not equivalent for every Reactive Reference widget. The UI
renders reference content and may submit a value-bearing HTML input; the API
does not render that HTML. The suite asserts those documented differences
explicitly instead of treating them as selector parity.

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

The suite checks the installed `uno-choice` version before creating jobs. It
uses uniquely named fixtures and deletes them in a `finally` block. A failure
report contains parameter values and job names, never authentication headers.

## What it checks

- Choice and Cascade Choice: single select, multi-select, radio, and checkbox.
- Reactive Reference: read-only text box, ordered list, unordered list,
  formatted HTML, and formatted hidden HTML.
- UI/API parity for selector values, including stored map keys rather than
  display labels.
- Cascading parent updates and API computed defaults when the child is omitted.
- Reference display refresh, HTML value submission, and expected server-side
  default differences.
- Anonymous Build Authorization Token Root requests used as inbound webhook-style
  triggers. The suite verifies that posted reference values do not override the
  fallback when the caller lacks authenticated Build permission.

This suite does not grant Jenkins Script Approval. The copied/renamed-job
identity behavior that needs access to `jenkinsProject` is covered by the
plugin's isolated JenkinsRule tests, where approvals are scoped to the test.
It tests the installed Build Authorization Token Root endpoint; it cannot test
SCM-specific webhook payload mappings because this controller has no SCM
webhook plugin installed.
