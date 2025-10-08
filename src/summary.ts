import * as path from 'node:path'
import * as core from '@actions/core'
import type { Context } from './github.js'
import type { TestReport } from './junitxml.js'

export const writeSummary = (testReport: TestReport, testCaseBaseDirectory: string, context: Context) => {
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length > 0) {
    core.summary.addHeading('Failed tests', 2)
    core.summary.addTable([
      [
        { data: 'Test case', header: true },
        { data: 'Test file', header: true },
        { data: 'Owner', header: true },
      ],
      ...failedTestCases.map((testCase) => [
        { data: `<code>${testCase.name}</code>` },
        {
          data: `<a href="${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${testCaseBaseDirectory}/${testCase.filename}">${testCase.filename}</a>`,
        },
        { data: testCase.owners.join('<br>') },
      ]),
    ])
  }

  for (const testCase of failedTestCases) {
    const canonicalPath = path.join(testCaseBaseDirectory, testCase.filename)
    core.error(`FAIL: (${testCase.owners.join()}) ${testCase.name}`, {
      file: canonicalPath,
    })
  }
}
