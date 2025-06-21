import * as core from '@actions/core'
import * as github from './github.js'
import { run } from './run.js'

const main = async (): Promise<void> => {
  await run(
    {
      junitXmlPath: core.getInput('junit-xml-path', { required: true }),
      metricNamePrefix: core.getInput('metric-name-prefix', { required: true }),
      filterTestFileSlowerThan: parseFloat(core.getInput('filter-test-file-slower-than', { required: true })),
      filterTestCaseSlowerThan: parseFloat(core.getInput('filter-test-case-slower-than', { required: true })),
      sendTestCaseSuccess: core.getBooleanInput('send-test-case-success', { required: true }),
      sendTestCaseFailure: core.getBooleanInput('send-test-case-failure', { required: true }),
      testCaseBaseDirectory: core.getInput('test-case-base-directory'),
      enableMetrics: core.getBooleanInput('enable-metrics', { required: true }),
      datadogApiKey: core.getInput('datadog-api-key'),
      datadogSite: core.getInput('datadog-site'),
      datadogTags: core.getMultilineInput('datadog-tags'),
    },
    github.getContext(),
  )
}

try {
  await main()
} catch (e) {
  core.setFailed(e instanceof Error ? e : String(e))
  console.error(e)
}
