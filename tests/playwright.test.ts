import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectPlaywrightReport, readPlaywrightReport } from '../src/playwright.js'

const makeReport = (test: Record<string, unknown>, stats = { expected: 1, skipped: 0, unexpected: 0, flaky: 0 }) => ({
  config: {
    projects: [{ name: 'chromium', retries: 1 }],
  },
  suites: [
    {
      title: 'app-shell.spec.ts',
      file: 'app-shell.spec.ts',
      specs: [],
      suites: [
        {
          title: 'app shell',
          file: 'app-shell.spec.ts',
          specs: [{ title: 'ログイン画面を表示できる', tests: [test] }],
        },
      ],
    },
  ],
  errors: [],
  stats,
})

const makeTest = (overrides: Record<string, unknown> = {}) => ({
  projectName: 'chromium',
  expectedStatus: 'passed',
  status: 'expected',
  results: [{ status: 'passed', duration: 120, retry: 0 }],
  ...overrides,
})

describe('inspectPlaywrightReport', () => {
  it.skipIf(!process.env.PLAYWRIGHT_JSON_REPORT)('accepts a real Playwright JSON report', async () => {
    const inspection = await readPlaywrightReport([process.env.PLAYWRIGHT_JSON_REPORT as string])

    expect(inspection.state).toBe('complete')
    expect(inspection.summary).toMatchObject({
      totalTests: 52,
    })
    expect(Object.values(inspection.summary.statusCounts).reduce((total, count) => total + count, 0)).toBe(52)
  })

  it('accepts a complete report without retries', () => {
    const inspection = inspectPlaywrightReport(makeReport(makeTest()))

    expect(inspection.state).toBe('complete')
    expect(inspection.summary).toMatchObject({
      totalTests: 1,
      statusCounts: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
      testsWithRetries: 0,
      retryAttempts: 0,
      flakyTests: [],
      finalFailureTests: [],
      retryExhaustedTests: [],
    })
  })

  it('accepts an unnamed Playwright project', () => {
    const report = makeReport(makeTest({ projectName: '' }))
    report.config.projects[0].name = ''

    const inspection = inspectPlaywrightReport(report)

    expect(inspection.state).toBe('complete')
  })

  it('records a test recovered by a retry', () => {
    const inspection = inspectPlaywrightReport(
      makeReport(
        makeTest({
          status: 'flaky',
          results: [
            { status: 'failed', duration: 120, retry: 0 },
            { status: 'passed', duration: 80, retry: 1 },
          ],
        }),
        { expected: 0, skipped: 0, unexpected: 0, flaky: 1 },
      ),
    )

    expect(inspection.state).toBe('complete')
    expect(inspection.summary.testsWithRetries).toBe(1)
    expect(inspection.summary.retryAttempts).toBe(1)
    expect(inspection.summary.flakyTests).toEqual([
      {
        project: 'chromium',
        file: 'app-shell.spec.ts',
        name: 'app-shell.spec.ts › app shell › ログイン画面を表示できる',
        retryAttempts: 1,
      },
    ])
  })

  it('records a final failure that exhausted configured retries', () => {
    const inspection = inspectPlaywrightReport(
      makeReport(
        makeTest({
          status: 'unexpected',
          results: [
            { status: 'failed', duration: 120, retry: 0 },
            { status: 'failed', duration: 80, retry: 1 },
          ],
        }),
        { expected: 0, skipped: 0, unexpected: 1, flaky: 0 },
      ),
    )

    expect(inspection.state).toBe('complete')
    expect(inspection.summary.finalFailureTests).toHaveLength(1)
    expect(inspection.summary.retryExhaustedTests).toHaveLength(1)
  })

  it('accepts an explicitly skipped test with a skipped result', () => {
    const inspection = inspectPlaywrightReport(
      makeReport(
        makeTest({
          expectedStatus: 'skipped',
          status: 'skipped',
          results: [{ status: 'skipped', duration: 0, retry: 0 }],
        }),
        {
          expected: 0,
          skipped: 1,
          unexpected: 0,
          flaky: 0,
        },
      ),
    )

    expect(inspection.state).toBe('complete')
    expect(inspection.summary.statusCounts.skipped).toBe(1)
  })

  it('does not treat a did-not-run test as an explicitly skipped test', () => {
    const inspection = inspectPlaywrightReport(
      makeReport(makeTest({ expectedStatus: 'passed', status: 'skipped', results: [] }), {
        expected: 0,
        skipped: 1,
        unexpected: 0,
        flaky: 0,
      }),
    )

    expect(inspection.state).toBe('incomplete')
    expect(inspection.reasonCodes).toContain('not_run_test')
  })

  it('does not expose raw errors in the summary for an incomplete report', () => {
    const inspection = inspectPlaywrightReport({
      ...makeReport(makeTest()),
      errors: [{ message: 'token=secret', stack: 'secret stack' }],
    })

    expect(inspection.state).toBe('incomplete')
    expect(inspection.reasonCodes).toEqual(['report_errors'])
    expect(JSON.stringify(inspection.summary)).not.toContain('secret')
  })

  it('rejects interrupted reports', () => {
    const inspection = inspectPlaywrightReport(
      makeReport(
        makeTest({
          status: 'unexpected',
          results: [{ status: 'interrupted', duration: 120, retry: 0 }],
        }),
        { expected: 0, skipped: 0, unexpected: 1, flaky: 0 },
      ),
    )

    expect(inspection.state).toBe('incomplete')
    expect(inspection.reasonCodes).toEqual(['interrupted_result'])
  })

  it('rejects an empty report and a stats mismatch', () => {
    const empty = inspectPlaywrightReport({
      config: { projects: [{ name: 'chromium', retries: 1 }] },
      suites: [],
      errors: [],
      stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
    })
    expect(empty.state).toBe('incomplete')
    expect(empty.reasonCodes).toEqual(['empty_report'])

    const mismatch = inspectPlaywrightReport(
      makeReport(makeTest(), { expected: 0, skipped: 0, unexpected: 1, flaky: 0 }),
    )
    expect(mismatch.state).toBe('incomplete')
    expect(mismatch.reasonCodes).toEqual(['stats_mismatch'])
  })

  it('marks malformed JSON as invalid', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-report-observability-playwright-'))
    const reportPath = path.join(directory, 'report.json')
    await fs.writeFile(reportPath, '{invalid', 'utf8')
    try {
      const inspection = await readPlaywrightReport([reportPath])
      expect(inspection.state).toBe('invalid')
      expect(inspection.reasonCodes).toEqual(['json_parse_error'])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
