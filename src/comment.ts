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
  const lines = [
    ...formatFailedTestCases(testReport, testCaseBaseDirectory, context),
    ...formatFlakyTestCases(flakyTestCases, testCaseBaseDirectory, context),
  ]
  if (lines.length > 0) {
    lines.push(
      `[GitHub Actions](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`,
    )
    return lines.join('\n')
  }
}

const formatFailedTestCases = (testReport: TestReport, testCaseBaseDirectory: string, context: Context): string[] => {
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length === 0) {
    return []
  }
  const lines = [`## :x: Failed tests (${context.workflow})`]
  if (failedTestCases.length > 100) {
    lines.push(`${failedTestCases.length} test cases failed.`)
    return lines
  }
  if (failedTestCases.length > 10) {
    for (const testCase of failedTestCases) {
      lines.push(
        `- ` +
          `[${testCase.filename}](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${testCaseBaseDirectory}/${testCase.filename})` +
          `: ${testCase.name}` +
          ` (${testCase.owners.join(', ')})`,
      )
    }
    return lines
  }
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
  return lines
}

const formatFlakyTestCases = (
  flakyTestCases: FailedTestCase[],
  testCaseBaseDirectory: string,
  context: Context,
): string[] => {
  if (flakyTestCases.length === 0) {
    return []
  }
  const lines = [`## :warning: Flaky tests (${context.workflow})`]
  if (flakyTestCases.length > 10) {
    lines.push(`${flakyTestCases.length} test cases are flaky.`)
    return lines
  }
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
  return lines
}

const formatFailureMessage = (failureMessage: string): string[] => {
  if (failureMessage.length > 1000) {
    return ['<details>', '```', failureMessage, '```', '</details>']
  }
  return ['```', failureMessage, '```']
}
