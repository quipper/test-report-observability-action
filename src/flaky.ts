import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DefaultArtifactClient } from '@actions/artifact'
import type { Context } from './github.js'
import type { TestCase, TestReport } from './junitxml.js'

type FailedTestReport = {
  testCases: TestCase[]
}

export const findFlakyTestCases = async (testReport: TestReport, context: Context) => {
  await uploadFailedTestReport(testReport, context)

  const lastFailedTestReport = await findLastFailedTestReport(context)
  if (!lastFailedTestReport) {
    return []
  }
  const flakyTestCases = lastFailedTestReport.testCases.filter((lastFailedTestCase) =>
    testReport.testCases.some(
      (currentTestCase) =>
        currentTestCase.success &&
        currentTestCase.name === lastFailedTestCase.name &&
        currentTestCase.filename === lastFailedTestCase.filename,
    ),
  )
  return flakyTestCases
}

const uploadFailedTestReport = async (testReport: TestReport, context: Context): Promise<void> => {
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length === 0) {
    return
  }
  const failedTestReport: FailedTestReport = {
    testCases: failedTestCases,
  }
  const tempDir = await fs.mkdtemp(path.join(context.runnerTemp, 'failed-test-report-'))
  const failedTestReportFilePath = path.join(tempDir, 'failed-test-report.json')
  await fs.writeFile(failedTestReportFilePath, JSON.stringify(failedTestReport), 'utf-8')
  const artifactClient = new DefaultArtifactClient()
  await artifactClient.uploadArtifact(`failed-test-report-${context.runAttempt}`, [failedTestReportFilePath], tempDir)
}

const findLastFailedTestReport = async (context: Context): Promise<FailedTestReport | undefined> => {
  if (context.runAttempt === 1) {
    return
  }
  const artifactClient = new DefaultArtifactClient()
  const lastFailedTestReportArtifact = await artifactClient
    .getArtifact(`failed-test-report-${context.runAttempt - 1}`)
    .catch(() => null)
  if (lastFailedTestReportArtifact === null) {
    return
  }

  const tempDir = await fs.mkdtemp(path.join(context.runnerTemp, 'failed-test-report-'))
  await artifactClient.downloadArtifact(lastFailedTestReportArtifact.artifact.id, { path: tempDir })
  const failedTestReportFilePath = path.join(tempDir, 'failed-test-report.json')
  const failedTestReportContent = await fs.readFile(failedTestReportFilePath, 'utf-8')
  return JSON.parse(failedTestReportContent) as FailedTestReport
}
