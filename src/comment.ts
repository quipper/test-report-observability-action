import * as core from '@actions/core'
import { Octokit } from '@octokit/action'
import { Context } from './github.js'
import { TestReport } from './junitxml.js'

export const postComment = async (testReport: TestReport, octokit: Octokit, context: Context) => {}

const format = (testReport: TestReport, context: Context): string => {
  const rows = []
  const failedTestCases = testReport.testCases.filter((testCase) => !testCase.success)
  for (const failedTestCase of failedTestCases) {
    rows.push([failedTestCase.filename, failedTestCase.name])
  }
  const table = `<table>${rows.map((columns) => `<tr>${columns.map((column) => `<td>${column}</td>`).join('')}</tr>`).join('')}</table>`
}

const createOrUpdateComment = async (body: string, octokit: Octokit, context: Context) => {
  if (!('pull_request' in context.payload)) {
    return
  }

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number,
    sort: 'created',
    direction: 'desc',
    per_page: 100,
  })
  core.info(`Found ${comments.length} comments of ${context.payload.pull_request.html_url}`)

  const commentKey = `<!-- ${context.workflow} -->`
  const existingComment = comments.find((comment) => comment.body?.includes(commentKey))
  if (existingComment) {
    core.info(`Updating the existing comment ${existingComment.id} of ${context.payload.pull_request.html_url}`)
    await octokit.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existingComment.id,
      body: `${body}\n${commentKey}`,
    })
  } else {
    core.info(`Creating a comment into ${context.payload.pull_request.html_url}`)
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request.number,
      body: `${body}\n${commentKey}`,
    })
  }
}
