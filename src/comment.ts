import * as core from '@actions/core'
import type { Octokit } from '@octokit/action'
import type { Context } from './github.js'
import type { TestReport } from './junitxml.js'

export const postComment = async (
  testReport: TestReport,
  testCaseBaseDirectory: string,
  octokit: Octokit,
  context: Context,
) => {
  if (!('pull_request' in context.payload)) {
    return
  }
  const body = format(testReport, testCaseBaseDirectory, context)
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

const format = (testReport: TestReport, testCaseBaseDirectory: string, context: Context): string => {
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  if (failedTestCases.length === 0) {
    return ''
  }

  const lines = [`## :x: ${context.workflow}: Failed tests`]
  for (const testCase of failedTestCases) {
    lines.push(
      `###` +
        `[${testCase.filename}](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${testCaseBaseDirectory}/${testCase.filename})` +
        `: ${testCase.name}`,
    )
    lines.push(`Owner: ${testCase.owners.join(', ')}`)
    if (testCase.failureMessage) {
      lines.push('```')
      lines.push(testCase.failureMessage)
      lines.push('```')
    }
  }
  lines.push(
    `[GitHub Actions](${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId})`,
  )
  return lines.join('\n')
}
