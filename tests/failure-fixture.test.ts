import { it } from 'vitest'
import { getContext } from '../src/github'

it.skipIf(process.env.ENABLE_TEST_FAILUTE_FIXTURE !== 'true')(
  'fails intentionally on the first attempt in GitHub Actions',
  () => {
    const context = getContext()
    if (context.runAttempt === 1) {
      throw new Error('Intentional failure on the first attempt in GitHub Actions')
    }
  },
)
