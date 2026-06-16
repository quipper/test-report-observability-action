import * as core from '@actions/core'
import type { Octokit } from '@octokit/action'
import type { FailedTestCase } from './flaky.js'
import type { Context } from './github.js'
import type { TestReport } from './junitxml.js'

export const postComment = async (
  testReport: TestReport,
  flakyTestCases: FailedTestCase[],
  testCaseBaseDirectory: string,
  octokit: Octokit,
  context: Context,
) => {
  if (!('pull_request' in context.payload)) {
    return
  }
  const body = format(testReport, flakyTestCases, testCaseBaseDirectory, context)
  if (!body) {
    return
  }
  const { data: comment } = await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number,
    body,
  })
  core.info(`Created ${comment.html_url}`)
}

const format = (
  testReport: TestReport,
  flakyTestCases: FailedTestCase[],
  testCaseBaseDirectory: string,
  context: Context,
): string | undefined => {
  const lines = []

  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length > 0) {
    lines.push(`## :x: Failed tests (${context.workflow})`)
    for (const testCase of failedTestCases) {
      lines.push(
        `### ` +
          `[${testCase.filename}](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${testCaseBaseDirectory}/${testCase.filename})` +
          `: ${testCase.name}`,
      )
      lines.push(`Owner: ${testCase.owners.join(', ')}`)
      if (testCase.failureMessage) {
        lines.push(...formatFailureMessage(testCase.failureMessage))
      }
    }
  }

  if (flakyTestCases.length > 0) {
    lines.push(`## :warning: Flaky tests (${context.workflow})`)
    for (const testCase of flakyTestCases) {
      lines.push(
        `### ` +
          `[${testCase.filename}](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${testCaseBaseDirectory}/${testCase.filename})` +
          `: ${testCase.name}`,
      )
      lines.push(`Owner: ${testCase.owners.join(', ')}`)
      if (testCase.failureMessage) {
        lines.push(...formatFailureMessage(testCase.failureMessage))
      }
    }
  }

  if (lines.length > 0) {
    lines.push(
      `[GitHub Actions](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`,
    )
    return lines.join('\n')
  }
}

const formatFailureMessage = (failureMessage: string): string[] => {
  if (failureMessage.length > 1000) {
    return ['<details>', '```', failureMessage, '```', '</details>']
  }
  return ['```', failureMessage, '```']
}
