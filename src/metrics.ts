import type { v1 } from '@datadog/datadog-api-client'
import type { TestCase, TestFile, TestReport } from './junitxml.js'

export type Metrics = {
  series: v1.Series[]
  distributionPointsSeries: v1.DistributionPointsSeries[]
}

export type Context = {
  prefix: string
  tags: string[]
  timestamp: number
  filterTestFileSlowerThan: number
  filterTestCaseSlowerThan: number
  sendTestCaseSuccess: boolean
  sendTestCaseFailure: boolean
}

export const getTestReportMetrics = (testReport: TestReport, context: Context): Metrics => {
  return joinMetrics(
    ...testReport.testFiles.map((testFile) => getTestFileMetrics(testFile, context)),
    ...testReport.testCases.map((testCase) => getTestCaseMetrics(testCase, context)),
  )
}

const getTestFileMetrics = (testFile: TestFile, context: Context): Metrics => {
  const tags = [
    ...context.tags,
    `testfile_name:${testFile.filename}`,
    ...testFile.owners.map((owner) => `testfile_owner:${owner}`),
  ]
  const metrics: Metrics = {
    series: [],
    distributionPointsSeries: [],
  }

  const duration = testFile.totalTime
  if (duration > context.filterTestFileSlowerThan) {
    metrics.distributionPointsSeries.push({
      metric: `${context.prefix}.testfile.duration`,
      points: [[context.timestamp, [duration]]],
      tags,
    })
  }

  return metrics
}

const getTestCaseMetrics = (testCase: TestCase, context: Context): Metrics => {
  const tags = [
    ...context.tags,
    `testcase_name:${testCase.name}`,
    `testcase_file:${testCase.filename}`,
    ...testCase.owners.map((owner) => `testcase_owner:${owner}`),
  ]
  const metrics: Metrics = {
    series: [],
    distributionPointsSeries: [],
  }

  if (testCase.success) {
    if (context.sendTestCaseSuccess) {
      metrics.series.push({
        metric: `${context.prefix}.testcase.success_count`,
        points: [[context.timestamp, 1]],
        type: 'count',
        tags,
      })
    }
  } else {
    if (context.sendTestCaseFailure) {
      metrics.series.push({
        metric: `${context.prefix}.testcase.failure_count`,
        points: [[context.timestamp, 1]],
        type: 'count',
        tags,
      })
    }
  }

  const duration = testCase.time
  if (duration > context.filterTestCaseSlowerThan) {
    metrics.distributionPointsSeries.push({
      metric: `${context.prefix}.testcase.duration`,
      points: [[context.timestamp, [duration]]],
      tags,
    })
  }

  return metrics
}

const joinMetrics = (...metricsArray: Metrics[]): Metrics => {
  const joined: Metrics = {
    series: [],
    distributionPointsSeries: [],
  }
  for (const metrics of metricsArray) {
    joined.series.push(...metrics.series)
    joined.distributionPointsSeries.push(...metrics.distributionPointsSeries)
  }
  return joined
}
