import { describe, expect, it } from 'vitest'
import type { TestReport } from '../src/junitxml.js'
import { type Context, getTestReportMetrics } from '../src/metrics.js'

describe('getTestReportMetrics', () => {
  it('returns metrics for a test report', () => {
    const testReport: TestReport = {
      testCases: [
        {
          name: 'testCase1',
          filename: 'tests/registration.test.js',
          time: 2.113871,
          success: true,
          owners: [],
        },
        {
          name: 'testCase2',
          filename: 'tests/registration.test.js',
          time: 1.051,
          success: true,
          owners: [],
        },
        {
          name: 'testCase3',
          filename: 'tests/registration.test.js',
          time: 3.441,
          success: true,
          owners: [],
        },
        {
          name: 'testCase4',
          filename: 'tests/registration.test.js',
          time: 2.244,
          success: true,
          owners: [],
        },
        {
          name: 'testCase5',
          filename: 'tests/registration.test.js',
          time: 0.781,
          success: true,
          owners: [],
        },
        {
          name: 'testCase6',
          filename: 'tests/registration.test.js',
          time: 1.331,
          success: true,
          owners: [],
        },
        {
          name: 'testCase7',
          filename: 'tests/registration.test.js',
          time: 2.508,
          success: true,
          owners: [],
        },
        {
          name: 'testCase8',
          filename: 'tests/registration.test.js',
          time: 1.230816,
          success: true,
          owners: [],
        },
        {
          name: 'testCase9',
          filename: 'tests/registration.test.js',
          time: 0.982,
          success: false,
          owners: [],
        },
      ],
      testFiles: [
        {
          filename: 'tests/registration.test.js',
          totalTime: 14.651688,
          totalTestCases: 9,
          owners: [],
        },
      ],
    }
    const context: Context = {
      prefix: 'testreport',
      tags: ['env:ci'],
      timestamp: 1234567890,
      filterTestFileSlowerThan: 1,
      filterTestCaseSlowerThan: 1,
      sendTestCaseSuccess: true,
      sendTestCaseFailure: true,
    }

    const metrics = getTestReportMetrics(testReport, context)
    expect(metrics.series).toMatchSnapshot()
  })
})
