import { describe, expect, test } from 'vitest'
import { truncateFailureMessage } from '../src/sentry.js'

describe('truncateFailureMessage', () => {
    test.each([
        { given: undefined, expected: undefined },
        { given: "", expected: "" },
        { given: "Error: something wrong", expected: "Error: something wrong" },
        { given: "Error: something wrong\nSECOND LINE WILL BE TRUNCATED", expected: "Error: something wrong\n(truncated...)" },
        { given: "Error: something wrong\r\nSECOND LINE WILL BE TRUNCATED", expected: "Error: something wrong\n(truncated...)" },
    ])(`truncateFailureMessage($given) should output $expected`, ({ given, expected }) => {
        console.log("%o %o %o", given, expected, truncateFailureMessage(given))
        expect(truncateFailureMessage(given)).toEqual(expected)
    })
})
