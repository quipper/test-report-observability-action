import { expect, it } from 'vitest'
import { getContext } from '../src/github.js'

it.skipIf(process.env.ENABLE_FLAKY_TEST_FIXTURE !== 'true')(
  'fails intentionally on the first attempt in GitHub Actions',
  async () => {
    const context = await getContext()
    expect(context.runAttempt).not.toBe(1)
  },
)
