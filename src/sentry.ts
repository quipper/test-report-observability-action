import path from 'node:path'
import * as sentry from '@sentry/node-core/light'
import type { FailedTestCase } from './flaky.js'
import type { Context } from './github.js'

export const sendFlakyTestCasesToSentry = (
  flakyTestCases: FailedTestCase[],
  testCaseBaseDirectory: string,
  context: Context,
) => {
  for (const testCase of flakyTestCases) {
    const testFilePath = path.join(testCaseBaseDirectory, testCase.filename)
    const event: sentry.Event = {
      message: testCase.name,
      fingerprint: [testFilePath, testCase.name],
      tags: {
        repository_owner: context.repo.owner,
        repository_name: context.repo.repo,
        workflow_name: context.workflow,
        event_name: context.eventName,
        ref_name: context.refName,
        workflow_run_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
        workflow_run_attempt: context.runAttempt,
      },
      release: context.sha,
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
                  abs_path: path.join(context.workspace, testFilePath),
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }
    sentry.captureEvent(event)
  }
}
