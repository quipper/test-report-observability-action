import path from 'node:path'
import * as sentry from '@sentry/node-core/light'
import type { FailedTestCase } from './flaky.js'

type SentryContext = {
  testCaseBaseDirectory: string
  tags: string[]
}

export const sendFlakyTestCasesToSentry = (flakyTestCases: FailedTestCase[], context: SentryContext) => {
  const tags = Object.fromEntries(
    context.tags.map((tag) => {
      const key = tag.split(':')[0]
      const value = tag.split(':').slice(1).join(':')
      return [key, value]
    }),
  )
  for (const testCase of flakyTestCases) {
    const testFilePath = path.join(context.testCaseBaseDirectory, testCase.filename)
    const event: sentry.Event = {
      message: testCase.name,
      fingerprint: [testFilePath, testCase.name],
      tags: {
        ...tags,
        'testcase.owners': testCase.owners.join(','),
        'testcase.filename': testCase.filename,
      },
      exception: {
        values: [
          {
            module: testFilePath,
            type: testCase.name,
            value: testCase.failureMessage,
            stacktrace: {
              frames: [
                {
                  filename: testFilePath,
                  function: testCase.name,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [],
    }
    sentry.captureEvent(event)
  }
}
