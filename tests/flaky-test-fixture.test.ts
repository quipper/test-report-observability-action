import { it } from 'vitest'
import { getContext } from '../src/github.js'

it.skipIf(process.env.ENABLE_FLAKY_TEST_FIXTURE !== 'true')(
  'fails intentionally on the first attempt in GitHub Actions',
  async () => {
    const context = await getContext()
    if (context.runAttempt === 1) {
      throw new Error('Intentional failure on the first attempt in GitHub Actions')
    }
  },
)
