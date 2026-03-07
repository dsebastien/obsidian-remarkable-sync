import { describe, expect, test } from 'bun:test'
import { fuzzyMatch } from './fuzzy-match'

describe('fuzzyMatch', () => {
    test('should match exact strings', () => {
        expect(fuzzyMatch('hello', 'hello')).toBe(true)
    })

    test('should match case-insensitively', () => {
        expect(fuzzyMatch('Hello', 'hello')).toBe(true)
        expect(fuzzyMatch('hello', 'HELLO')).toBe(true)
    })

    test('should match substrings', () => {
        expect(fuzzyMatch('note', 'My Notebook')).toBe(true)
    })

    test('should match subsequences', () => {
        expect(fuzzyMatch('mnb', 'My Notebook')).toBe(true)
    })

    test('should not match unrelated strings', () => {
        expect(fuzzyMatch('xyz', 'hello')).toBe(false)
    })

    test('should match empty query against any target', () => {
        expect(fuzzyMatch('', 'anything')).toBe(true)
    })

    test('should match with folder paths', () => {
        expect(fuzzyMatch('work', 'Work/My Notes')).toBe(true)
        expect(fuzzyMatch('notes', 'Work/My Notes')).toBe(true)
    })
})
