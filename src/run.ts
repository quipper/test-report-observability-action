import * as core from '@actions/core'
import * as glob from '@actions/glob'
import type { Octokit } from '@octokit/action'
import { createFinder } from './codeowners.js'
import { postComment } from './comment.js'
import { createMetricsClient } from './datadog.js'
import { findFlakyTestCases, uploadCurrentFailedTestReport } from './flaky.js'
import type { Context } from './github.js'
import { parseTestReportFiles } from './junitxml.js'
import { getTestReportMetrics } from './metrics.js'
import { sendFlakyTestCasesToSentry } from './sentry.js'
import { writeSummary } from './summary.js'

type Inputs = {
  junitXmlPath: string
  metricNamePrefix: string
  filterTestFileSlowerThan: number
  filterTestCaseSlowerThan: number
  failedTestReportArtifactNamePrefix: string
  sendTestCaseSuccess: boolean
  sendTestCaseFailure: boolean
  testCaseBaseDirectory: string
  enableMetrics: boolean
  datadogApiKey: string
  datadogSite: string
  tags: string[]
  enableComment: boolean
}

export const run = async (inputs: Inputs, octokit: Octokit, context: Context): Promise<void> => {
  const junitXmlGlob = await glob.create(inputs.junitXmlPath)
  const junitXmlFiles = await junitXmlGlob.glob()
  const testReport = await parseTestReportFiles(junitXmlFiles, await createFinder(inputs.testCaseBaseDirectory))

  await uploadCurrentFailedTestReport(testReport, inputs, context)
  const flakyTestCases = await findFlakyTestCases(testReport, inputs, context)

  if (inputs.enableComment) {
    await postComment(testReport, flakyTestCases, inputs.testCaseBaseDirectory, octokit, context)
  }

  sendFlakyTestCasesToSentry(flakyTestCases, {
    testCaseBaseDirectory: inputs.testCaseBaseDirectory,
    tags: [
      `github.repository_owner:${context.repo.owner}`,
      `github.repository_name:${context.repo.repo}`,
      `github.workflow_name:${context.workflow}`,
      `github.event_name:${context.eventName}`,
      `github.ref_name:${context.refName}`,
      `github.sha:${context.sha}`,
      `github.workflow_run.url:${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
      `github.workflow_run.attempt:${context.runAttempt}`,
      ...inputs.tags,
    ],
  })

  const metricsContext = {
    prefix: inputs.metricNamePrefix,
    tags: [
      // Keep less cardinality for cost perspective.
      `repository_owner:${context.repo.owner}`,
      `repository_name:${context.repo.repo}`,
      `workflow_name:${context.workflow}`,
      `event_name:${context.eventName}`,
      `ref_name:${context.refName}`,
      ...inputs.tags,
    ],
    timestamp: unixTime(new Date()),
    filterTestFileSlowerThan: inputs.filterTestFileSlowerThan,
    filterTestCaseSlowerThan: inputs.filterTestCaseSlowerThan,
    sendTestCaseSuccess: inputs.sendTestCaseSuccess,
    sendTestCaseFailure: inputs.sendTestCaseFailure,
  }
  core.startGroup('Metrics context')
  core.info(JSON.stringify(metricsContext, undefined, 2))
  core.endGroup()

  const metrics = getTestReportMetrics(testReport, flakyTestCases, metricsContext)
  const metricsClient = createMetricsClient(inputs)
  await metricsClient.submitMetrics(metrics.series, `${junitXmlFiles.length} files`)
  await metricsClient.submitDistributionPoints(metrics.distributionPointsSeries, `${junitXmlFiles.length} files`)

  writeSummary(testReport, flakyTestCases, inputs.testCaseBaseDirectory, context)
  await core.summary.write()
}

const unixTime = (date: Date): number => Math.floor(date.getTime() / 1000)
