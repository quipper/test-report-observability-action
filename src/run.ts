import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { createFinder } from './codeowners.js'
import { createMetricsClient } from './datadog.js'
import { findFlakyTestCases, uploadCurrentFailedTestReport } from './flaky.js'
import type { Context } from './github.js'
import {
  createTestCaseFileResolver,
  parseTestReportFiles,
  type TestCaseFileFallback,
  type TestReport,
} from './junitxml.js'
import { getTestReportMetrics } from './metrics.js'
import {
  addPlaywrightReasonCode,
  addPlaywrightSummary,
  type PlaywrightReportInspection,
  readPlaywrightReport,
  writePlaywrightRetrySummary,
} from './playwright.js'
import { sendFlakyTestCasesToSentry } from './sentry.js'
import { writeSummary } from './summary.js'

export type Inputs = {
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
  testCaseFileFallback: TestCaseFileFallback
  playwrightJsonPath: string
  requireCompletePlaywrightReport: boolean
  playwrightRetrySummaryPath: string
}

export const run = async (inputs: Inputs, context: Context): Promise<void> => {
  const playwrightReport = await readPlaywrightReportIfConfigured(inputs)
  if (playwrightReport) {
    core.setOutput('playwright-report-state', playwrightReport.state)
    if (inputs.playwrightRetrySummaryPath) {
      await writePlaywrightRetrySummary(inputs.playwrightRetrySummaryPath, playwrightReport)
    }
    addPlaywrightSummary(playwrightReport)
  }

  if (inputs.requireCompletePlaywrightReport && playwrightReport?.state !== 'complete') {
    core.warning(
      `Datadog metrics suppressed: ${playwrightReport?.reasonCodes.join(', ') || 'playwright_report_not_configured'}`,
    )
    await core.summary.write()
    return
  }

  const junitXmlGlob = await glob.create(inputs.junitXmlPath)
  const junitXmlFiles = await junitXmlGlob.glob()
  if (junitXmlFiles.length === 0 && inputs.requireCompletePlaywrightReport) {
    await suppressMetricsForObservation('junit_report_not_found', playwrightReport, inputs.playwrightRetrySummaryPath)
    return
  }

  let testReport: TestReport
  try {
    const resolveTestCaseFile = await createTestCaseFileResolver(
      inputs.testCaseBaseDirectory,
      inputs.testCaseFileFallback,
    )
    testReport = await parseTestReportFiles(
      junitXmlFiles,
      await createFinder(inputs.testCaseBaseDirectory),
      resolveTestCaseFile,
    )
  } catch (error) {
    if (isPlaywrightObservationEnabled(inputs)) {
      const reasonCode = getJunitObservationReasonCode(error)
      await suppressMetricsForObservation(reasonCode, playwrightReport, inputs.playwrightRetrySummaryPath)
      return
    }
    throw error
  }

  await uploadCurrentFailedTestReport(testReport, inputs, context)
  const flakyTestCases = await findFlakyTestCases(testReport, inputs, context)

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

const suppressMetricsForObservation = async (
  reasonCode: string,
  playwrightReport: PlaywrightReportInspection | undefined,
  playwrightRetrySummaryPath: string,
): Promise<void> => {
  core.warning(`Datadog metrics suppressed: ${reasonCode}`)
  core.summary.addHeading('Datadog observation', 2)
  core.summary.addRaw(`<p>Metrics suppressed: ${reasonCode}</p>`)
  if (playwrightReport && playwrightRetrySummaryPath) {
    await writePlaywrightRetrySummary(playwrightRetrySummaryPath, addPlaywrightReasonCode(playwrightReport, reasonCode))
  }
  await core.summary.write()
}

const readPlaywrightReportIfConfigured = async (inputs: Inputs): Promise<PlaywrightReportInspection | undefined> => {
  if (!inputs.playwrightJsonPath && !inputs.requireCompletePlaywrightReport) {
    return
  }
  if (!inputs.playwrightJsonPath) {
    return readPlaywrightReport([])
  }
  const reportGlob = await glob.create(inputs.playwrightJsonPath)
  return readPlaywrightReport(await reportGlob.glob())
}

const isPlaywrightObservationEnabled = (inputs: Inputs): boolean =>
  inputs.requireCompletePlaywrightReport ||
  inputs.testCaseFileFallback !== 'none' ||
  Boolean(inputs.playwrightJsonPath) ||
  Boolean(inputs.playwrightRetrySummaryPath)

const getJunitObservationReasonCode = (error: unknown): string => {
  if (error instanceof Error && error.message.includes('ambiguous')) {
    return 'junit_file_ambiguous'
  }
  if (error instanceof Error && error.message.includes('without classname')) {
    return 'junit_classname_missing'
  }
  if (error instanceof Error && error.message.includes('Cannot resolve')) {
    return 'junit_file_unresolved'
  }
  return 'junit_parse_error'
}

const unixTime = (date: Date): number => Math.floor(date.getTime() / 1000)
