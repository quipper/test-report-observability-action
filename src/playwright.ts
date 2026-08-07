import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'

export const playwrightReportStates = ['complete', 'incomplete', 'missing', 'invalid'] as const
export type PlaywrightReportState = (typeof playwrightReportStates)[number]

export type PlaywrightTestStatus = 'expected' | 'skipped' | 'unexpected' | 'flaky'

type PlaywrightTestResult = {
  status: string
  duration: number
  retry: number
}

type PlaywrightTest = {
  project: string
  file: string
  name: string
  status: PlaywrightTestStatus
  results: PlaywrightTestResult[]
  configuredRetries: number
}

export type PlaywrightTestIdentifier = {
  project: string
  file: string
  name: string
  retryAttempts: number
}

export type PlaywrightRetrySummary = {
  reportState: PlaywrightReportState
  reasonCodes: string[]
  totalTests: number
  statusCounts: Record<PlaywrightTestStatus, number>
  testsWithRetries: number
  retryAttempts: number
  flakyTests: PlaywrightTestIdentifier[]
  finalFailureTests: PlaywrightTestIdentifier[]
  retryExhaustedTests: PlaywrightTestIdentifier[]
}

export type PlaywrightReportInspection = {
  state: PlaywrightReportState
  reasonCodes: string[]
  summary: PlaywrightRetrySummary
}

type RecordValue = Record<string, unknown>

const knownTestStatuses = new Set<PlaywrightTestStatus>(['expected', 'skipped', 'unexpected', 'flaky'])
const knownExpectedStatuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'])

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0

const asRequiredString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const sanitizeIdentifier = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1f && codePoint !== 0x7f
    })
    .join('')
    .slice(0, 512)

const createSummary = (state: PlaywrightReportState, reasonCodes: string[] = []): PlaywrightRetrySummary => ({
  reportState: state,
  reasonCodes,
  totalTests: 0,
  statusCounts: {
    expected: 0,
    skipped: 0,
    unexpected: 0,
    flaky: 0,
  },
  testsWithRetries: 0,
  retryAttempts: 0,
  flakyTests: [],
  finalFailureTests: [],
  retryExhaustedTests: [],
})

const invalidInspection = (reasonCodes: string[]): PlaywrightReportInspection => ({
  state: 'invalid',
  reasonCodes,
  summary: createSummary('invalid', reasonCodes),
})

const incompleteInspection = (tests: PlaywrightTest[], reasonCodes: string[]): PlaywrightReportInspection => {
  const summary = buildRetrySummary(tests, 'incomplete', reasonCodes)
  return {
    state: 'incomplete',
    reasonCodes,
    summary,
  }
}

export const inspectPlaywrightReport = (report: unknown): PlaywrightReportInspection => {
  if (!isRecord(report)) {
    return invalidInspection(['schema_invalid'])
  }

  const config = report.config
  const suites = report.suites
  const errors = report.errors
  const stats = report.stats
  if (
    !isRecord(config) ||
    !Array.isArray(config.projects) ||
    !Array.isArray(suites) ||
    !Array.isArray(errors) ||
    !isRecord(stats)
  ) {
    return invalidInspection(['schema_invalid'])
  }

  const projectRetries = new Map<string, number>()
  for (const project of config.projects) {
    const projectName = isRecord(project) && typeof project.name === 'string' ? project.name : undefined
    if (projectName === undefined || !isRecord(project) || !isNonNegativeInteger(project.retries)) {
      return invalidInspection(['schema_invalid'])
    }
    projectRetries.set(projectName, project.retries)
  }

  const statusCounts = {
    expected: stats.expected,
    skipped: stats.skipped,
    unexpected: stats.unexpected,
    flaky: stats.flaky,
  }
  if (!Object.values(statusCounts).every(isNonNegativeInteger)) {
    return invalidInspection(['schema_invalid'])
  }

  const parsedTests: PlaywrightTest[] = []
  const structuralReasonCodes: string[] = []
  for (const suite of suites) {
    collectTests(suite, undefined, [], projectRetries, parsedTests, structuralReasonCodes)
  }
  const incompleteSchemaReasonCodes = new Set(['missing_results', 'not_run_test'])
  const invalidReasonCodes = structuralReasonCodes.filter((reasonCode) => !incompleteSchemaReasonCodes.has(reasonCode))
  if (invalidReasonCodes.length > 0) {
    return invalidInspection([...new Set(invalidReasonCodes)])
  }

  const incompleteReasonCodes: string[] = structuralReasonCodes.filter((reasonCode) =>
    incompleteSchemaReasonCodes.has(reasonCode),
  )
  if (errors.length > 0) {
    incompleteReasonCodes.push('report_errors')
  }
  if (parsedTests.length === 0) {
    incompleteReasonCodes.push('empty_report')
  }
  if (parsedTests.some((test) => test.results.some((result) => result.status === 'interrupted'))) {
    incompleteReasonCodes.push('interrupted_result')
  }

  const actualStatusCounts = {
    expected: 0,
    skipped: 0,
    unexpected: 0,
    flaky: 0,
  }
  for (const test of parsedTests) {
    actualStatusCounts[test.status]++
  }
  if (!sameStatusCounts(actualStatusCounts, statusCounts)) {
    incompleteReasonCodes.push('stats_mismatch')
  }

  if (incompleteReasonCodes.length > 0) {
    return incompleteInspection(parsedTests, [...new Set(incompleteReasonCodes)])
  }

  return {
    state: 'complete',
    reasonCodes: [],
    summary: buildRetrySummary(parsedTests, 'complete'),
  }
}

const collectTests = (
  suite: unknown,
  inheritedFile: string | undefined,
  suiteTitles: string[],
  projectRetries: Map<string, number>,
  tests: PlaywrightTest[],
  reasonCodes: string[],
): void => {
  if (!isRecord(suite)) {
    reasonCodes.push('schema_invalid')
    return
  }

  const file = asRequiredString(suite.file) ?? inheritedFile
  const title = typeof suite.title === 'string' ? suite.title : undefined
  const nextTitles = title ? [...suiteTitles, title] : suiteTitles
  if (suite.specs !== undefined && !Array.isArray(suite.specs)) {
    reasonCodes.push('schema_invalid')
    return
  }
  if (suite.suites !== undefined && !Array.isArray(suite.suites)) {
    reasonCodes.push('schema_invalid')
    return
  }

  for (const spec of suite.specs ?? []) {
    const specTitle = isRecord(spec) ? asRequiredString(spec.title) : undefined
    if (!specTitle || !isRecord(spec) || !Array.isArray(spec.tests)) {
      reasonCodes.push('schema_spec')
      continue
    }
    for (const test of spec.tests) {
      const parsedTest = parseTest(test, file, nextTitles, specTitle, projectRetries, reasonCodes)
      if (parsedTest) {
        tests.push(parsedTest)
      }
    }
  }

  for (const nestedSuite of suite.suites ?? []) {
    collectTests(nestedSuite, file, nextTitles, projectRetries, tests, reasonCodes)
  }
}

const parseTest = (
  value: unknown,
  file: string | undefined,
  suiteTitles: string[],
  testTitle: string,
  projectRetries: Map<string, number>,
  reasonCodes: string[],
): PlaywrightTest | undefined => {
  if (!isRecord(value)) {
    reasonCodes.push('schema_invalid')
    return
  }
  const project = typeof value.projectName === 'string' ? value.projectName : undefined
  const expectedStatus = value.expectedStatus
  const status = value.status
  const results = value.results
  if (
    project === undefined ||
    !file ||
    typeof expectedStatus !== 'string' ||
    !knownExpectedStatuses.has(expectedStatus) ||
    !knownTestStatuses.has(status as PlaywrightTestStatus) ||
    !Array.isArray(results)
  ) {
    reasonCodes.push(knownTestStatuses.has(status as PlaywrightTestStatus) ? 'schema_invalid' : 'unknown_test_status')
    return
  }
  const configuredRetries = projectRetries.get(project)
  if (configuredRetries === undefined) {
    reasonCodes.push('project_missing')
    return
  }

  const parsedResults: PlaywrightTestResult[] = []
  for (const result of results) {
    if (
      !isRecord(result) ||
      typeof result.status !== 'string' ||
      !isFiniteNonNegativeNumber(result.duration) ||
      !isNonNegativeInteger(result.retry)
    ) {
      reasonCodes.push('schema_invalid')
      continue
    }
    parsedResults.push({
      status: result.status,
      duration: result.duration,
      retry: result.retry,
    })
  }
  if (parsedResults.length !== results.length) {
    return
  }
  if (parsedResults.length === 0) {
    reasonCodes.push(status === 'skipped' && expectedStatus !== 'skipped' ? 'not_run_test' : 'missing_results')
    return
  }
  if (status === 'skipped' && expectedStatus !== 'skipped') {
    reasonCodes.push('not_run_test')
    return
  }
  if (status === 'skipped' && !parsedResults.some((result) => result.status === 'skipped')) {
    reasonCodes.push('not_run_test')
    return
  }

  return {
    project,
    file,
    name: [...suiteTitles, testTitle].filter((part) => part !== '').join(' › '),
    status: status as PlaywrightTestStatus,
    results: parsedResults,
    configuredRetries,
  }
}

const sameStatusCounts = (
  actual: Record<PlaywrightTestStatus, number>,
  expected: Record<PlaywrightTestStatus, unknown>,
): boolean => (Object.keys(actual) as PlaywrightTestStatus[]).every((status) => actual[status] === expected[status])

const buildRetrySummary = (
  tests: PlaywrightTest[],
  reportState: PlaywrightReportState,
  reasonCodes: string[] = [],
): PlaywrightRetrySummary => {
  const statusCounts: Record<PlaywrightTestStatus, number> = {
    expected: 0,
    skipped: 0,
    unexpected: 0,
    flaky: 0,
  }
  const flakyTests: PlaywrightTestIdentifier[] = []
  const finalFailureTests: PlaywrightTestIdentifier[] = []
  const retryExhaustedTests: PlaywrightTestIdentifier[] = []
  let testsWithRetries = 0
  let retryAttempts = 0

  for (const test of tests) {
    statusCounts[test.status]++
    const testRetryAttempts = test.results.filter((result) => result.retry > 0).length
    if (testRetryAttempts > 0) {
      testsWithRetries++
      retryAttempts += testRetryAttempts
    }
    const identifier: PlaywrightTestIdentifier = {
      project: sanitizeIdentifier(test.project),
      file: sanitizeIdentifier(test.file),
      name: sanitizeIdentifier(test.name),
      retryAttempts: testRetryAttempts,
    }
    if (test.status === 'flaky') {
      flakyTests.push(identifier)
    }
    if (test.status === 'unexpected') {
      finalFailureTests.push(identifier)
      const maxRetry = Math.max(-1, ...test.results.map((result) => result.retry))
      if (
        reportState === 'complete' &&
        test.configuredRetries > 0 &&
        maxRetry === test.configuredRetries &&
        !test.results.some((result) => result.status === 'interrupted')
      ) {
        retryExhaustedTests.push(identifier)
      }
    }
  }

  return {
    reportState,
    reasonCodes: [...reasonCodes],
    totalTests: tests.length,
    statusCounts,
    testsWithRetries,
    retryAttempts,
    flakyTests,
    finalFailureTests,
    retryExhaustedTests,
  }
}

export const readPlaywrightReport = async (reportFiles: string[]): Promise<PlaywrightReportInspection> => {
  if (reportFiles.length === 0) {
    return {
      state: 'missing',
      reasonCodes: ['report_not_found'],
      summary: createSummary('missing', ['report_not_found']),
    }
  }
  if (reportFiles.length > 1) {
    return {
      state: 'invalid',
      reasonCodes: ['multiple_report_files'],
      summary: createSummary('invalid', ['multiple_report_files']),
    }
  }

  let content: string
  try {
    content = await fs.readFile(reportFiles[0], 'utf8')
  } catch {
    return {
      state: 'invalid',
      reasonCodes: ['report_read_error'],
      summary: createSummary('invalid', ['report_read_error']),
    }
  }

  try {
    return inspectPlaywrightReport(JSON.parse(content) as unknown)
  } catch {
    return {
      state: 'invalid',
      reasonCodes: ['json_parse_error'],
      summary: createSummary('invalid', ['json_parse_error']),
    }
  }
}

export const addPlaywrightReasonCode = (
  inspection: PlaywrightReportInspection,
  reasonCode: string,
): PlaywrightReportInspection => {
  if (inspection.reasonCodes.includes(reasonCode)) {
    return inspection
  }
  const reasonCodes = [...inspection.reasonCodes, reasonCode]
  return {
    ...inspection,
    reasonCodes,
    summary: {
      ...inspection.summary,
      reasonCodes,
    },
  }
}

export const writePlaywrightRetrySummary = async (
  summaryPath: string,
  inspection: PlaywrightReportInspection,
): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(path.resolve(summaryPath)), { recursive: true })
    await fs.writeFile(summaryPath, `${JSON.stringify(inspection.summary, null, 2)}\n`, 'utf8')
  } catch {
    core.warning('Could not write Playwright retry summary: summary_write_error')
  }
}

export const addPlaywrightSummary = (inspection: PlaywrightReportInspection): void => {
  core.summary.addHeading('Playwright report', 2)
  core.summary.addTable([
    [
      { data: 'State', header: true },
      { data: 'Tests', header: true },
      { data: 'Tests with retries', header: true },
      { data: 'Retry attempts', header: true },
      { data: 'Reasons', header: true },
    ],
    [
      { data: inspection.state },
      { data: String(inspection.summary.totalTests) },
      { data: String(inspection.summary.testsWithRetries) },
      { data: String(inspection.summary.retryAttempts) },
      { data: inspection.reasonCodes.join(', ') || '-' },
    ],
  ])

  addTestIdentifiers('Recovered after retry', inspection.summary.flakyTests)
  addTestIdentifiers('Final failures', inspection.summary.finalFailureTests)
  addTestIdentifiers('Retry exhausted', inspection.summary.retryExhaustedTests)
}

const addTestIdentifiers = (heading: string, tests: PlaywrightTestIdentifier[]): void => {
  if (tests.length === 0) {
    return
  }
  core.summary.addHeading(heading, 3)
  core.summary.addTable([
    [
      { data: 'Project', header: true },
      { data: 'File', header: true },
      { data: 'Test', header: true },
      { data: 'Retry attempts', header: true },
    ],
    ...tests.map((test) => [
      { data: escapeHtml(test.project) },
      { data: escapeHtml(test.file) },
      { data: escapeHtml(test.name) },
      { data: String(test.retryAttempts) },
    ]),
  ])
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
