import assert from 'node:assert'

export type Context = {
  repo: {
    owner: string
    repo: string
  }
  eventName: string
  refName: string
  serverUrl: string
  sha: string
  workflow: string
}

export const getContext = (): Context => {
  // https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables#default-environment-variables
  return {
    repo: getRepo(),
    eventName: getEnv('GITHUB_EVENT_NAME'),
    refName: getEnv('GITHUB_REF_NAME'),
    serverUrl: getEnv('GITHUB_SERVER_URL'),
    sha: getEnv('GITHUB_SHA'),
    workflow: getEnv('GITHUB_WORKFLOW'),
  }
}

const getRepo = () => {
  const [owner, repo] = getEnv('GITHUB_REPOSITORY').split('/')
  return { owner, repo }
}

const getEnv = (name: string): string => {
  assert(process.env[name], `${name} is required`)
  return process.env[name]
}
