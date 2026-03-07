import { test, expect, describe } from 'bun:test'
import { formatRemarkableDate } from './date-utils'

describe('date-utils', () => {
    test('formatRemarkableDate formats timestamp', () => {
        // Jan 1, 2026 12:00:00 UTC in milliseconds
        const timestamp = '1767268800000'
        const result = formatRemarkableDate(timestamp)
        // Just check it doesn't return 'Unknown'
        expect(result).not.toBe('Unknown')
        expect(result.length).toBeGreaterThan(0)
    })

    test('formatRemarkableDate returns Unknown for invalid input', () => {
        expect(formatRemarkableDate('not-a-number')).toBe('Unknown')
    })
})
