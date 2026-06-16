import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { DefaultArtifactClient } from '@actions/artifact'
import * as core from '@actions/core'
import { z } from 'zod'
import type { Context } from './github.js'
import type { TestReport } from './junitxml.js'

type FlakyTestConfig = {
  failedTestReportArtifactNamePrefix: string
}

const FailedTestCase = z.object({
  name: z.string(),
  filename: z.string(),
  owners: z.array(z.string()),
  failureMessage: z.string().optional(),
})

export type FailedTestCase = z.infer<typeof FailedTestCase>

const FailedTestReport = z.object({
  testCases: z.array(FailedTestCase),
})

type FailedTestReport = z.infer<typeof FailedTestReport>

export const uploadCurrentFailedTestReport = async (
  testReport: TestReport,
  config: FlakyTestConfig,
  context: Context,
) => {
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length === 0) {
    return
  }
  const failedTestReport: FailedTestReport = {
    testCases: failedTestCases,
  }
  const artifactName = `${config.failedTestReportArtifactNamePrefix}${context.runAttempt}`
  await core.group(`Uploading the artifact: ${artifactName}`, async () => {
    const tempDir = await fs.mkdtemp(path.join(context.runnerTemp, 'failed-test-report-'))
    const reportFilePath = path.join(tempDir, 'report.json')
    await fs.writeFile(reportFilePath, JSON.stringify(failedTestReport), 'utf-8')
    const artifactClient = new DefaultArtifactClient()
    await artifactClient.uploadArtifact(artifactName, [reportFilePath], tempDir)
  })
}

export const findFlakyTestCases = async (testReport: TestReport, config: FlakyTestConfig, context: Context) => {
  const lastFailedTestReport = await findLastFailedTestReport(config, context)
  if (lastFailedTestReport === undefined) {
    return []
  }
  return findFlakyTestCasesFromReports(lastFailedTestReport, testReport)
}

const findFlakyTestCasesFromReports = (
  lastFailedTestReport: FailedTestReport,
  currentTestReport: TestReport,
): FailedTestCase[] => {
  const flakyTestCases = lastFailedTestReport.testCases.filter((lastFailedTestCase) =>
    currentTestReport.testCases.some(
      (currentTestCase) =>
        currentTestCase.success &&
        currentTestCase.name === lastFailedTestCase.name &&
        currentTestCase.filename === lastFailedTestCase.filename,
    ),
  )
  return flakyTestCases
}

const findLastFailedTestReport = async (
  config: FlakyTestConfig,
  context: Context,
): Promise<FailedTestReport | undefined> => {
  if (context.runAttempt === 1) {
    return
  }
  const artifactClient = new DefaultArtifactClient()
  const artifactName = `${config.failedTestReportArtifactNamePrefix}${context.runAttempt - 1}`
  const lastFailedTestReportArtifact = await artifactClient.getArtifact(artifactName).catch((e) => {
    core.info(`No artifact found: ${artifactName}: ${e}`)
  })
  if (lastFailedTestReportArtifact === undefined) {
    return
  }
  return await core.group(`Downloading the artifact: ${lastFailedTestReportArtifact.artifact.name}`, async () => {
    const tempDir = await fs.mkdtemp(path.join(context.runnerTemp, 'failed-test-report-'))
    await artifactClient.downloadArtifact(lastFailedTestReportArtifact.artifact.id, { path: tempDir })
    const reportFilePath = path.join(tempDir, 'report.json')
    const reportContent = await fs.readFile(reportFilePath, 'utf-8')
    return FailedTestReport.parse(JSON.parse(reportContent))
  })
}
