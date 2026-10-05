import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import { XMLParser } from 'fast-xml-parser'
import * as z from 'zod'

export type TestReport = {
  testFiles: TestFile[]
  testCases: TestCase[]
}

export type TestFile = {
  filename: string
  owners: string[]
  totalTime: number
  totalTestCases: number
}

export type FindOwners = (filename: string) => string[]

export type TestCaseFileFallback = 'none' | 'unique-classname-basename'

export type TestCaseFileResolver = (testCase: { name: string; classname?: string }) => string

export const parseTestReportFiles = async (
  testReportFiles: string[],
  findOwners: FindOwners,
  resolveTestCaseFile?: TestCaseFileResolver,
): Promise<TestReport> => {
  const junitXmls = await parseTestReportFilesToJunitXml(testReportFiles)
  const allTestCases: TestCase[] = []
  for (const junitXml of junitXmls) {
    const testCases = findTestCasesFromJunitXml(junitXml, findOwners, resolveTestCaseFile)
    allTestCases.push(...testCases)
  }
  core.info(`Found ${allTestCases.length} test cases in the test reports`)
  const testFiles = groupTestCasesByTestFile(allTestCases)
  return {
    testFiles,
    testCases: allTestCases,
  }
}

export const groupTestCasesByTestFile = (testCases: TestCase[]): TestFile[] => {
  const testFiles = new Map<string, TestFile>()
  for (const testCase of testCases) {
    const currentTestFile = testFiles.get(testCase.filename) ?? {
      filename: testCase.filename,
      owners: testCase.owners,
      totalTime: 0,
      totalTestCases: 0,
    }
    currentTestFile.totalTime += testCase.time
    currentTestFile.totalTestCases++
    testFiles.set(testCase.filename, currentTestFile)
  }
  return [...testFiles.values()]
}

export type TestCase = {
  name: string
  filename: string
  owners: string[]
  time: number
  success: boolean
  failureMessage?: string
}

export const findTestCasesFromJunitXml = (
  junitXml: JunitXml,
  findOwners: FindOwners,
  resolveTestCaseFile?: TestCaseFileResolver,
): TestCase[] => {
  const root = junitXml.testsuites?.testsuite ?? junitXml.testsuite ?? []

  function* visit(testSuite: JunitXmlTestSuite): Generator<TestCase> {
    const determineTestCaseFilename = (junitXmlTestCase: JunitXmlTestCase): string => {
      if (junitXmlTestCase['@_file']) {
        return junitXmlTestCase['@_file']
      }
      // For Mocha or Cypress, the first <testsuite> element has the filename of the root suite.
      const mochaRootSuiteFilename = root.at(0)?.['@_file']
      if (mochaRootSuiteFilename) {
        return mochaRootSuiteFilename
      }
      if (resolveTestCaseFile) {
        return resolveTestCaseFile({
          name: junitXmlTestCase['@_name'],
          classname: junitXmlTestCase['@_classname'],
        })
      }
      throw new Error(`Element <testcase> must have "file" attribute (name=${junitXmlTestCase['@_name']})`)
    }

    for (const junitXmlTestCase of testSuite.testcase ?? []) {
      if (junitXmlTestCase['@_time'] === undefined && junitXmlTestCase.skipped === undefined) {
        throw new Error(`Element <testcase> must have "time" attribute (name=${junitXmlTestCase['@_name']})`)
      }
      const filename = path.normalize(determineTestCaseFilename(junitXmlTestCase))
      yield {
        name: junitXmlTestCase['@_name'],
        filename,
        owners: findOwners(filename),
        time: junitXmlTestCase['@_time'] ?? 0,
        success: !junitXmlTestCase.failure && !junitXmlTestCase.error,
        failureMessage:
          getTestCaseFailureMessage(junitXmlTestCase.failure) ?? getTestCaseFailureMessage(junitXmlTestCase.error),
      }
    }
    for (const nestedTestSuite of testSuite.testsuite ?? []) {
      visit(nestedTestSuite)
    }
  }

  const testCases: TestCase[] = []
  for (const testSuite of root) {
    for (const testCase of visit(testSuite)) {
      testCases.push(testCase)
    }
  }
  return testCases
}

const getTestCaseFailureMessage = (failure: JunitXmlTestCaseFailure | undefined): string | undefined => {
  if (Array.isArray(failure)) {
    return failure
      .map((failure) => {
        if (typeof failure === 'string') {
          return failure
        }
        if (typeof failure === 'object' && failure != null && '@_message' in failure) {
          return failure['@_message']
        }
        return ''
      })
      .join('\n')
  }
  if (typeof failure === 'string') {
    return failure
  }
  if (typeof failure === 'object' && failure != null && '@_message' in failure) {
    return failure['@_message']
  }
}

const parseTestReportFilesToJunitXml = async (testReportFiles: string[]): Promise<JunitXml[]> => {
  const junitXmls: JunitXml[] = []
  core.startGroup(`Parsing ${testReportFiles.length} test report files`)
  for (const testReportFile of testReportFiles) {
    core.info(`Parsing the test report: ${testReportFile}`)
    const xml = await fs.readFile(testReportFile)
    const junitXml = parseJunitXml(xml)
    junitXmls.push(junitXml)
  }
  core.endGroup()
  return junitXmls
}

const JunitXmlTestCaseFailure = z.union([
  z.string(),
  z.array(z.string()),
  z.object({
    '@_message': z.string().optional(),
    '#text': z.string().optional(),
  }),
  z.array(
    z.object({
      '@_message': z.string().optional(),
      '#text': z.string().optional(),
    }),
  ),
])

type JunitXmlTestCaseFailure = z.infer<typeof JunitXmlTestCaseFailure>

const JunitXmlTestCase = z.object({
  '@_name': z.string(),
  '@_time': z.number().optional(),
  '@_file': z.string().optional(),
  '@_classname': z.string().optional(),
  skipped: z.unknown().optional(),
  failure: JunitXmlTestCaseFailure.optional(),
  error: JunitXmlTestCaseFailure.optional(),
})

type JunitXmlTestCase = z.infer<typeof JunitXmlTestCase>

const JunitXmlTestSuite = z.object({
  get testsuite() {
    return z.array(JunitXmlTestSuite).optional()
  },
  testcase: z.array(JunitXmlTestCase).optional(),
  '@_file': z.string().optional(),
})

type JunitXmlTestSuite = z.infer<typeof JunitXmlTestSuite>

const JunitXml = z.object({
  testsuites: z
    .object({
      testsuite: z.array(JunitXmlTestSuite).optional(),
    })
    .optional(),
  testsuite: z.array(JunitXmlTestSuite).optional(),
})

type JunitXml = z.infer<typeof JunitXml>

export const parseJunitXml = (xml: string | Buffer): JunitXml => {
  const parser = new XMLParser({
    processEntities: {
      maxTotalExpansions: 100000,
    },
    ignoreAttributes: false,
    removeNSPrefix: true,
    isArray: (_: string, jPath: unknown): boolean => {
      const elementName = String(jPath).split('.').pop()
      return elementName === 'testsuite' || elementName === 'testcase'
    },
    attributeValueProcessor: (attrName: string, attrValue: string, jPath: unknown) => {
      const elementName = String(jPath).split('.').pop()
      if (
        (elementName === 'testsuites' || elementName === 'testsuite' || elementName === 'testcase') &&
        attrName === 'time'
      ) {
        return Number(attrValue)
      }
      return attrValue
    },
  })
  const parsed = parser.parse(xml)
  const junitXml = JunitXml.parse(parsed)
  validateTestCaseTimes(junitXml)
  return junitXml
}

const validateTestCaseTimes = (junitXml: JunitXml): void => {
  const root = junitXml.testsuites?.testsuite ?? junitXml.testsuite ?? []
  const visit = (testSuite: JunitXmlTestSuite): void => {
    for (const testCase of testSuite.testcase ?? []) {
      if (testCase['@_time'] === undefined && testCase.skipped === undefined) {
        throw new Error(`Element <testcase> must have "time" attribute (name=${testCase['@_name']})`)
      }
    }
    for (const nestedTestSuite of testSuite.testsuite ?? []) {
      visit(nestedTestSuite)
    }
  }
  for (const testSuite of root) {
    visit(testSuite)
  }
}

export const createTestCaseFileResolver = async (
  baseDirectory: string,
  fallback: TestCaseFileFallback,
): Promise<TestCaseFileResolver | undefined> => {
  if (fallback === 'none') {
    return
  }
  if (fallback !== 'unique-classname-basename') {
    throw new Error(`Unsupported test case file fallback: ${fallback}`)
  }
  if (!baseDirectory) {
    throw new Error('test-case-base-directory is required for classname basename fallback')
  }

  const resolvedBaseDirectory = path.resolve(baseDirectory)
  const files = await listFiles(resolvedBaseDirectory)
  const filesByBasename = new Map<string, string[]>()
  for (const file of files) {
    const basename = path.basename(file)
    const matches = filesByBasename.get(basename) ?? []
    matches.push(file)
    filesByBasename.set(basename, matches)
  }

  return ({ name, classname }) => {
    if (!classname) {
      throw new Error(`Cannot resolve JUnit testcase file without classname (name=${name})`)
    }
    const basename = path.basename(classname)
    const matches = filesByBasename.get(basename) ?? []
    if (matches.length === 0) {
      throw new Error(`Cannot resolve JUnit testcase file (classname=${classname})`)
    }
    if (matches.length > 1) {
      throw new Error(`Cannot resolve ambiguous JUnit testcase file (classname=${classname})`)
    }
    return path.normalize(path.relative(resolvedBaseDirectory, matches[0]))
  }
}

const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(file)))
    } else if (entry.isFile()) {
      files.push(file)
    }
  }
  return files.sort()
}
