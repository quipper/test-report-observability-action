# test-report-observability-action [![ts](https://github.com/quipper/test-report-observability-action/actions/workflows/ts.yaml/badge.svg)](https://github.com/quipper/test-report-observability-action/actions/workflows/ts.yaml)

This is an action for the observability of test reports.
It supports the JUnit XML format.

## Getting Started

To parse the test reports,

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
      - uses: quipper/test-report-observability-action@v0
        with:
          junit-xml-path: "**/junit.xml"
```

This action sends the metrics on `push`, `schedule`, or `workflow_run` events by default.
You can set `enable-metrics` input to change the condition.

## Metrics

All metrics have the following tags:

- `repository_owner`
- `repository_name`
- `workflow_name`

### `testreport.testcase.success_count` (count)

This metric represents the number of succeeded test cases.
It has the following tags:

- `testcase_name`
- `testcase_file`
- `testcase_owner`

This actions sends **only failed test cases by default**.
You can set `send-test-case-success` to send all test cases.
:warning: It may increase the custom metrics cost.

```yaml
- uses: quipper/test-report-observability-action@v0
  with:
    junit-xml-path: "**/junit.xml"
    send-test-case-success: true
```

### `testreport.testcase.failure_count` (count)

This metric represents the number of failed test cases.
It has the following tags:

- `testcase_name`
- `testcase_file`
- `testcase_owner`

### `testreport.testcase.flaky_failure_count` (count)

This metric represents the number of flaky failed test cases.
It has the following tags:

- `testcase_name`
- `testcase_file`
- `testcase_owner`

This action considers a test case as **flaky** if it was failed in the last attempt and succeeded in the current attempt.

### `testreport.testcase.duration` (distribution)

This metric represents the duration of test cases in seconds.
It has the following tags:

- `testcase_name`
- `testcase_conclusion` (`success` or `failure`)
- `testcase_file`
- `testcase_owner`

This action sends test cases **slower than 1 second by default**.
You can set `filter-test-case-slower-than` to send all test cases.
:warning: It may increase the custom metrics cost.

```yaml
- uses: quipper/test-report-observability-action@v0
  with:
    junit-xml-path: "**/junit.xml"
    filter-test-case-slower-than: 0
```

### `testreport.testfile.duration` (distribution)

This metric represents the duration of test files in seconds.
It has the following tags:

- `testfile_name`
- `testfile_owner`

This action sends test files **slower than 1 second by default**.
You can set `filter-test-file-slower-than` to send all test files.
:warning: It may increase the custom metrics cost.

```yaml
- uses: quipper/test-report-observability-action@v0
  with:
    junit-xml-path: "**/junit.xml"
    filter-test-file-slower-than: 0
```

## Tags

### Owner tags

If the repository has a [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-file-location) file,
this action adds the following tags to the metrics:

- `testcase_owner`
- `testfile_owner`

If the test report contains a relative path to the test case file,
you can set `test-case-base-directory` to resolve the path.

```yaml
- uses: quipper/test-report-observability-action@v0
  with:
    junit-xml-path: microservice/junit.xml
    test-case-base-directory: microservice
```

## Specification

### Inputs

| Name                                      | Default        | Description                                                               |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| `junit-xml-path`                          | (required)     | Glob pattern to the JUnit XML file(s)                                     |
| `metric-name-prefix`                      | `testreport`   | Prefix of the name of metrics                                             |
| `filter-test-file-slower-than`            | 1              | Filter test files slower than the threshold (in seconds)                  |
| `filter-test-case-slower-than`            | 1              | Filter test cases slower than the threshold (in seconds)                  |
| `failed-test-report-artifact-name-prefix` | <sup>\*1</sup> | The artifact name of the failed test report for detecting the flaky tests |
| `test-case-base-directory`                | -              | Base directory to resolve the test case file path                         |
| `test-case-file-fallback`                 | `none`         | Fallback to resolve a missing JUnit testcase file attribute               |
| `playwright-json-path`                    | -              | Glob pattern to the Playwright JSON report                                 |
| `require-complete-playwright-report`      | `false`        | Suppress metrics unless the Playwright JSON report is complete             |
| `playwright-retry-summary-path`            | -              | Path for a sanitized Playwright retry summary JSON                         |
| `enable-metrics`                          | <sup>\*1</sup> | If false, do not send the metrics to Datadog                              |
| `send-test-case-success`                  | false          | Send succeeded test cases                                                 |
| `send-test-case-failure`                  | true           | Send failed test cases                                                    |
| `datadog-api-key`                         | -              | Datadog API key                                                           |
| `datadog-site`                            | -              | Datadog site                                                              |
| `sentry-dsn`                              | -              | Sentry DSN for sending the test cases                                     |
| `tags`                                    | -              | Tags for Datadog and Sentry                                               |

<sup>\*1</sup> See [action.yaml](action.yaml) for the default value.

## Playwright reports

The official Playwright JUnit reporter does not include a `file` attribute on each testcase.
To resolve its `classname` basename below a repository directory, enable the opt-in fallback:

```yaml
- uses: quipper/test-report-observability-action@v0
  with:
    junit-xml-path: qlearn-react/.test/e2e/junit.xml
    test-case-base-directory: qlearn-react/e2e/tests
    test-case-file-fallback: unique-classname-basename
    playwright-json-path: qlearn-react/.test/e2e/json/report.json
    require-complete-playwright-report: true
    playwright-retry-summary-path: qlearn-react/.test/e2e/playwright-retry-summary.json
```

When `require-complete-playwright-report` is enabled, missing, invalid, or incomplete Playwright reports suppress metrics and are reported in the Job Summary.
The retry summary contains test identifiers and retry counts, but not error messages, stack traces, standard output, or attachments.
Existing JUnit-only users are unchanged when these inputs are omitted.

### Outputs

| Name | Description |
| ---- | ----------- |
| `playwright-report-state` | The Playwright report state when `playwright-json-path` is configured |
