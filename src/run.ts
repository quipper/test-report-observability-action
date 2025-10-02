import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { createFinder } from './codeowners.js'
import { createMetricsClient } from './datadog.js'
import type { Context } from './github.js'
import { parseTestReportFiles } from './junitxml.js'
import { getTestReportMetrics } from './metrics.js'
import { writeSummary } from './summary.js'

type Inputs = {
  junitXmlPath: string
  metricNamePrefix: string
  filterTestFileSlowerThan: number
  filterTestCaseSlowerThan: number
  sendTestCaseSuccess: boolean
  sendTestCaseFailure: boolean
  testCaseBaseDirectory: string
  enableMetrics: boolean
  datadogApiKey: string
  datadogSite: string
  datadogTags: string[]
}

export const run = async (inputs: Inputs, context: Context): Promise<void> => {
  const junitXmlGlob = await glob.create(inputs.junitXmlPath)
  const junitXmlFiles = await junitXmlGlob.glob()
  const testReport = await parseTestReportFiles(junitXmlFiles, await createFinder(inputs.testCaseBaseDirectory))

  const workflowTags = [
    // Keep less cardinality for cost perspective.
    `repository_owner:${context.repo.owner}`,
    `repository_name:${context.repo.repo}`,
    `workflow_name:${context.workflow}`,
    `event_name:${context.eventName}`,
    `ref_name:${context.refName}`,
  ]
  const metricsContext = {
    prefix: inputs.metricNamePrefix,
    tags: [...workflowTags, ...inputs.datadogTags],
    timestamp: unixTime(new Date()),
    filterTestFileSlowerThan: inputs.filterTestFileSlowerThan,
    filterTestCaseSlowerThan: inputs.filterTestCaseSlowerThan,
    sendTestCaseSuccess: inputs.sendTestCaseSuccess,
    sendTestCaseFailure: inputs.sendTestCaseFailure,
  }
  core.startGroup('Metrics context')
  core.info(JSON.stringify(metricsContext, undefined, 2))
  core.endGroup()

  const metrics = getTestReportMetrics(testReport, metricsContext)
  const metricsClient = createMetricsClient(inputs)
  await metricsClient.submitMetrics(metrics.series, `${junitXmlFiles.length} files`)
  await metricsClient.submitDistributionPoints(metrics.distributionPointsSeries, `${junitXmlFiles.length} files`)

  writeSummary(testReport, inputs.testCaseBaseDirectory, context)
  await core.summary.write()
}

const unixTime = (date: Date): number => Math.floor(date.getTime() / 1000)
