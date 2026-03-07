import { test, expect, describe } from 'bun:test'
import { formatForFrontmatter, formatRemarkableDate, parseISODate } from './date-utils'

describe('date-utils', () => {
    test('formatForFrontmatter returns ISO string', () => {
        const date = new Date('2026-03-07T10:30:00Z')
        const result = formatForFrontmatter(date)
        expect(result).toBe('2026-03-07T10:30:00.000Z')
    })

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

    test('parseISODate parses ISO string', () => {
        const date = parseISODate('2026-03-07T10:30:00.000Z')
        expect(date.getFullYear()).toBe(2026)
        expect(date.getMonth()).toBe(2) // March = 2 (0-indexed)
        expect(date.getDate()).toBe(7)
    })
})
