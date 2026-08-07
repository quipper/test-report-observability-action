import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as core from '@actions/core'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/github.js'
import { type Inputs, run } from '../src/run.js'

const mocks = vi.hoisted(() => ({
  createFinder: vi.fn(),
  createMetricsClient: vi.fn(),
  findFlakyTestCases: vi.fn(),
  uploadCurrentFailedTestReport: vi.fn(),
  sendFlakyTestCasesToSentry: vi.fn(),
  submitMetrics: vi.fn(),
  submitDistributionPoints: vi.fn(),
}))

vi.mock('../src/codeowners.js', () => ({
  createFinder: mocks.createFinder,
}))
vi.mock('../src/datadog.js', () => ({
  createMetricsClient: mocks.createMetricsClient,
}))
vi.mock('../src/flaky.js', () => ({
  findFlakyTestCases: mocks.findFlakyTestCases,
  uploadCurrentFailedTestReport: mocks.uploadCurrentFailedTestReport,
}))
vi.mock('../src/sentry.js', () => ({
  sendFlakyTestCasesToSentry: mocks.sendFlakyTestCasesToSentry,
}))

const context: Context = {
  repo: { owner: 'quipper', repo: 'monorepo' },
  eventName: 'push',
  refName: 'develop',
  runAttempt: 1,
  runId: 1,
  runnerTemp: os.tmpdir(),
  serverUrl: 'https://github.com',
  sha: 'sha',
  workflow: 'workflow',
  workspace: process.cwd(),
}

let directory: string
const summaryFile = path.join(os.tmpdir(), `test-report-observability-summary-${process.pid}.md`)

afterAll(async () => {
  await fs.rm(summaryFile, { force: true })
})

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-report-observability-run-'))
  process.env.GITHUB_OUTPUT = path.join(directory, 'github-output')
  process.env.GITHUB_STEP_SUMMARY = summaryFile
  await fs.writeFile(process.env.GITHUB_OUTPUT, '', 'utf8')
  await fs.writeFile(summaryFile, '', 'utf8')
  core.summary.emptyBuffer()

  mocks.createFinder.mockResolvedValue(() => [])
  mocks.findFlakyTestCases.mockResolvedValue([])
  mocks.uploadCurrentFailedTestReport.mockResolvedValue(undefined)
  mocks.sendFlakyTestCasesToSentry.mockReturnValue(undefined)
  mocks.submitMetrics.mockResolvedValue(undefined)
  mocks.submitDistributionPoints.mockResolvedValue(undefined)
  mocks.createMetricsClient.mockReturnValue({
    submitMetrics: mocks.submitMetrics,
    submitDistributionPoints: mocks.submitDistributionPoints,
  })
})

afterEach(async () => {
  core.summary.emptyBuffer()
  await fs.rm(directory, { recursive: true, force: true })
  delete process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_STEP_SUMMARY
  vi.clearAllMocks()
})

const makeInputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  junitXmlPath: path.join(directory, 'junit.xml'),
  metricNamePrefix: 'testreport',
  filterTestFileSlowerThan: 0,
  filterTestCaseSlowerThan: 0,
  failedTestReportArtifactNamePrefix: 'failed-test-report-',
  sendTestCaseSuccess: false,
  sendTestCaseFailure: true,
  testCaseBaseDirectory: directory,
  enableMetrics: true,
  datadogApiKey: 'not-used-in-test',
  datadogSite: '',
  tags: [],
  testCaseFileFallback: 'none',
  playwrightJsonPath: path.join(directory, 'report.json'),
  requireCompletePlaywrightReport: true,
  playwrightRetrySummaryPath: path.join(directory, 'retry-summary.json'),
  ...overrides,
})

const completeReport = {
  config: { projects: [{ name: 'chromium', retries: 1 }] },
  suites: [
    {
      title: 'app.spec.ts',
      file: 'app.spec.ts',
      specs: [
        {
          title: 'passes',
          tests: [
            {
              projectName: 'chromium',
              expectedStatus: 'passed',
              status: 'expected',
              results: [{ status: 'passed', duration: 10, retry: 0 }],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
  stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
}

const writeReport = async (report: unknown): Promise<void> => {
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report), 'utf8')
}

const writeJunit = async (): Promise<void> => {
  await fs.writeFile(
    path.join(directory, 'junit.xml'),
    '<testsuite><testcase name="passes" time="2" file="app.spec.ts" /></testsuite>',
    'utf8',
  )
}

describe('run', () => {
  it('continues existing observation processing for a complete Playwright report', async () => {
    await writeReport(completeReport)
    await writeJunit()

    await run(makeInputs(), context)

    expect(mocks.uploadCurrentFailedTestReport).toHaveBeenCalledOnce()
    expect(mocks.findFlakyTestCases).toHaveBeenCalledOnce()
    expect(mocks.createMetricsClient).toHaveBeenCalledOnce()
    expect(mocks.submitMetrics).toHaveBeenCalledOnce()
    expect(mocks.submitDistributionPoints).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing', undefined],
    ['invalid', '{invalid'],
    ['incomplete', JSON.stringify({ ...completeReport, errors: [{ message: 'test failed' }] })],
  ])('suppresses observation side effects for a %s Playwright report', async (_state, reportContent) => {
    if (reportContent !== undefined) {
      await fs.writeFile(path.join(directory, 'report.json'), reportContent, 'utf8')
    }

    await run(makeInputs(), context)

    expect(mocks.uploadCurrentFailedTestReport).not.toHaveBeenCalled()
    expect(mocks.findFlakyTestCases).not.toHaveBeenCalled()
    expect(mocks.sendFlakyTestCasesToSentry).not.toHaveBeenCalled()
    expect(mocks.createMetricsClient).not.toHaveBeenCalled()
    expect(mocks.submitMetrics).not.toHaveBeenCalled()
    expect(mocks.submitDistributionPoints).not.toHaveBeenCalled()
  })

  it('suppresses observation when the Playwright report is complete but JUnit is missing', async () => {
    const inputs = makeInputs()
    await writeReport(completeReport)

    await run(inputs, context)

    expect(mocks.createMetricsClient).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(inputs.playwrightRetrySummaryPath, 'utf8')).reasonCodes).toContain(
      'junit_report_not_found',
    )
  })

  it.each([
    ['unresolved', 'missing.spec.ts', 'junit_file_unresolved'],
    ['ambiguous', 'duplicate.spec.ts', 'junit_file_ambiguous'],
  ])('suppresses observation when classname fallback is %s', async (_caseName, classname, reasonCode) => {
    const inputs = makeInputs({
      testCaseFileFallback: 'unique-classname-basename',
    })
    await writeReport(completeReport)
    await fs.writeFile(
      inputs.junitXmlPath,
      `<testsuite><testcase name="passes" time="2" classname="${classname}" /></testsuite>`,
      'utf8',
    )
    if (reasonCode === 'junit_file_ambiguous') {
      await fs.mkdir(path.join(directory, 'one'), { recursive: true })
      await fs.mkdir(path.join(directory, 'two'), { recursive: true })
      await fs.writeFile(path.join(directory, 'one', classname), '')
      await fs.writeFile(path.join(directory, 'two', classname), '')
    }

    await run(inputs, context)

    expect(mocks.createMetricsClient).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(inputs.playwrightRetrySummaryPath, 'utf8')).reasonCodes).toContain(reasonCode)
  })
})
