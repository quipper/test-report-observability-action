import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findTestCasesFromJunitXml,
  groupTestCasesByTestFile,
  parseJunitXml,
  parseTestReportFiles,
  type TestCase,
  type TestReport,
} from '../src/junitxml.js'

describe('parseTestReportFiles', () => {
  it('should parse rspec.xml', async () => {
    const testReportFiles = [path.join(__dirname, 'fixtures/rspec1.xml'), path.join(__dirname, 'fixtures/rspec2.xml')]
    const testReport = await parseTestReportFiles(testReportFiles, () => [])
    expect(testReport).toEqual<TestReport>({
      testFiles: [
        { filename: 'spec/a_spec.rb', totalTime: 3, totalTestCases: 2, owners: [] },
        { filename: 'spec/b_spec.rb', totalTime: 12, totalTestCases: 3, owners: [] },
        { filename: 'spec/c_spec.rb', totalTime: 13, totalTestCases: 2, owners: [] },
      ],
      testCases: [
        { name: 'a1', filename: 'spec/a_spec.rb', time: 1, success: true, owners: [] },
        { name: 'a2', filename: 'spec/a_spec.rb', time: 2, success: true, owners: [] },
        { name: 'b1', filename: 'spec/b_spec.rb', time: 3, success: true, owners: [] },
        { name: 'b2', filename: 'spec/b_spec.rb', time: 4, success: true, owners: [] },
        { name: 'b3', filename: 'spec/b_spec.rb', time: 5, success: true, owners: [] },
        { name: 'c1', filename: 'spec/c_spec.rb', time: 6, success: true, owners: [] },
        { name: 'c2', filename: 'spec/c_spec.rb', time: 7, success: true, owners: [] },
      ],
    })
  })

  it('should parse cypress.xml', async () => {
    const testReportFiles = [
      path.join(__dirname, 'fixtures/cypress1.xml'),
      path.join(__dirname, 'fixtures/cypress2.xml'),
    ]
    const testReport = await parseTestReportFiles(testReportFiles, () => [])
    expect(testReport).toEqual<TestReport>({
      testFiles: [
        { filename: 'cypress/a_spec.ts', totalTime: 6, totalTestCases: 3, owners: [] },
        { filename: 'cypress/b_spec.ts', totalTime: 4, totalTestCases: 1, owners: [] },
      ],
      testCases: [
        { name: 'Test 1', filename: 'cypress/a_spec.ts', time: 1, success: true, owners: [] },
        { name: 'Test 2', filename: 'cypress/a_spec.ts', time: 2, success: true, owners: [] },
        { name: 'Test 1', filename: 'cypress/a_spec.ts', time: 3, success: true, owners: [] },
        { name: 'Test 1', filename: 'cypress/b_spec.ts', time: 4, success: true, owners: [] },
      ],
    })
  })
})

describe('parseJunitXml', () => {
  it('parses fixture.xml', async () => {
    const xml = await fs.readFile(path.join(__dirname, 'fixtures/fixture.xml'))
    expect(() => parseJunitXml(xml)).not.toThrow()
  })

  it('parses <failure> element with text node', () => {
    const xml = `
      <testsuite>
        <testcase name="test1" time="1" file="file1">
          <failure>Stack trace</failure>
        </testcase>
      </testsuite>
    `
    const junitXml = parseJunitXml(xml)
    expect(junitXml.testsuite?.at(0)?.testcase?.at(0)?.failure).toStrictEqual('Stack trace')
  })

  it('parses <failure> element with message attribute', () => {
    const xml = `
      <testsuite>
        <testcase name="test1" time="1" file="file1">
          <failure message="Test failed"></failure>
        </testcase>
      </testsuite>
    `
    const junitXml = parseJunitXml(xml)
    expect(junitXml.testsuite?.at(0)?.testcase?.at(0)?.failure).toStrictEqual({
      '@_message': 'Test failed',
    })
  })

  it('parses <failure> element with message attribute and text node', () => {
    const xml = `
      <testsuite>
        <testcase name="test1" time="1" file="file1">
          <failure message="Test failed">Stack trace</failure>
        </testcase>
      </testsuite>
    `
    const junitXml = parseJunitXml(xml)
    expect(junitXml.testsuite?.at(0)?.testcase?.at(0)?.failure).toStrictEqual({
      '@_message': 'Test failed',
    })
  })

  it('parses <failure> elements with text node', () => {
    const xml = `
      <testsuite>
        <testcase name="test1" time="1" file="file1">
          <failure>Stack trace</failure>
          <failure>Another</failure>
        </testcase>
      </testsuite>
    `
    const junitXml = parseJunitXml(xml)
    expect(junitXml.testsuite?.at(0)?.testcase?.at(0)?.failure).toStrictEqual(['Stack trace', 'Another'])
  })
})

describe('findTestCasesFromJunitXml', () => {
  it('should return test cases', () => {
    const junitXml = {
      testsuite: [
        {
          testcase: [
            { '@_name': 'test1', '@_time': 1, '@_file': 'file1' },
            { '@_name': 'test2', '@_time': 2, '@_file': 'file2' },
            { '@_name': 'test3', '@_time': 3, '@_file': 'file1' },
          ],
        },
        {
          testcase: [
            { '@_name': 'test4', '@_time': 4, '@_file': 'file2' },
            { '@_name': 'test5', '@_time': 5, '@_file': 'file3' },
          ],
        },
      ],
    }
    expect(findTestCasesFromJunitXml(junitXml, () => [])).toEqual<TestCase[]>([
      { name: 'test1', filename: 'file1', time: 1, success: true, owners: [] },
      { name: 'test2', filename: 'file2', time: 2, success: true, owners: [] },
      { name: 'test3', filename: 'file1', time: 3, success: true, owners: [] },
      { name: 'test4', filename: 'file2', time: 4, success: true, owners: [] },
      { name: 'test5', filename: 'file3', time: 5, success: true, owners: [] },
    ])
  })

  it('should normalize file paths', () => {
    const junitXml = {
      testsuite: [
        {
          testcase: [
            { '@_name': 'test1', '@_time': 1, '@_file': 'file1' },
            { '@_name': 'test2', '@_time': 2, '@_file': './file2' },
            { '@_name': 'test3', '@_time': 3, '@_file': './file1' },
          ],
        },
      ],
    }
    expect(findTestCasesFromJunitXml(junitXml, () => [])).toEqual<TestCase[]>([
      { name: 'test1', filename: 'file1', time: 1, success: true, owners: [] },
      { name: 'test2', filename: 'file2', time: 2, success: true, owners: [] },
      { name: 'test3', filename: 'file1', time: 3, success: true, owners: [] },
    ])
  })
})

describe('groupTestCasesByTestFile', () => {
  it('should group test cases by file', () => {
    const testCases: TestCase[] = [
      { name: 'test1', filename: 'file1', time: 1, success: true, owners: [] },
      { name: 'test2', filename: 'file2', time: 2, success: true, owners: [] },
      { name: 'test3', filename: 'file1', time: 3, success: true, owners: [] },
      { name: 'test4', filename: 'file2', time: 4, success: true, owners: [] },
      { name: 'test5', filename: 'file3', time: 5, success: true, owners: [] },
    ]
    expect(groupTestCasesByTestFile(testCases)).toEqual([
      { filename: 'file1', totalTime: 4, totalTestCases: 2, owners: [] },
      { filename: 'file2', totalTime: 6, totalTestCases: 2, owners: [] },
      { filename: 'file3', totalTime: 5, totalTestCases: 1, owners: [] },
    ])
  })
})
