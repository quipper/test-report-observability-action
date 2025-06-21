import * as core from '@actions/core'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Minimatch } from 'minimatch'

export type Rule = {
  pattern: string
  owners: string[]
}

// Parse the CODEOWNERS and return the records in order.
export const parse = (content: string): Rule[] => {
  const rules: Rule[] = []
  const lines = content.split(/[\r\n]+/)
  for (const line of lines) {
    const owners = line
      .replace(/#.+$/, '')
      .split(/\s+/)
      .filter((s) => s !== '')
    const pattern = owners.shift()
    if (!pattern) {
      continue
    }
    rules.push({ pattern, owners })
  }
  return rules
}

type RuleMatcher = {
  match(filename: string): boolean
  owners: string[]
}

const compile = (rule: Rule): RuleMatcher => {
  let pattern = rule.pattern
  if (pattern.startsWith('**')) {
    pattern = `/${pattern}`
  } else if (!pattern.startsWith('/')) {
    pattern = `/**/${pattern}`
  }
  if (pattern.endsWith('/')) {
    pattern = `${pattern}**`
  }
  const m = new Minimatch(pattern, {
    dot: true,
    nobrace: true,
    nocomment: true,
    noext: true,
    nonegate: true,
  })
  return {
    match: (filename: string) => {
      if (!filename.startsWith('/')) {
        filename = '/' + filename
      }
      return m.match(filename)
    },
    owners: rule.owners,
  }
}

export class Matcher {
  private readonly ruleMatchers: RuleMatcher[]

  constructor(rules: Rule[]) {
    this.ruleMatchers = rules
      .map((rule) => compile(rule))
      // We need to find one in reverse order. The last mentioned code owner is valid.
      // https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-syntax
      .reverse()
  }

  findOwners(filename: string): string[] {
    for (const ruleMatcher of this.ruleMatchers) {
      if (ruleMatcher.match(filename)) {
        return ruleMatcher.owners
      }
    }
    return []
  }
}

export const createMatcher = (codeownersContent: string) => new Matcher(parse(codeownersContent))

type Finder = (filename: string) => string[]

export const createFinder = async (baseDirectory: string): Promise<Finder> => {
  const tryAccess = async (path: string): Promise<string | null> => {
    try {
      await fs.access(path)
      return path
    } catch {
      return null
    }
  }
  // https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-file-location
  const codeowners =
    (await tryAccess('.github/CODEOWNERS')) ?? (await tryAccess('CODEOWNERS')) ?? (await tryAccess('docs/CODEOWNERS'))
  if (!codeowners) {
    return () => []
  }
  core.info(`Parsing ${codeowners}`)
  const matcher = createMatcher(await fs.readFile(codeowners, 'utf8'))
  return (filename: string) => {
    const canonicalPath = path.join(baseDirectory, filename)
    return matcher.findOwners(canonicalPath).map((owner) => owner.replace(/^@.+?\/|^@/, '')) // Remove leading @organization/
  }
}
