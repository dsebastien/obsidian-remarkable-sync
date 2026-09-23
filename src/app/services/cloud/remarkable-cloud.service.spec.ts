import { describe, expect, test } from 'bun:test'
import { resolveFolderPath } from './remarkable-cloud.service'

describe('resolveFolderPath', () => {
    const names = new Map([
        ['a', 'Work'],
        ['b', 'Meetings'],
        ['c', 'Q3']
    ])
    const parents = new Map([
        ['a', ''],
        ['b', 'a'],
        ['c', 'b']
    ])

    test('walks the full parent chain', () => {
        expect(resolveFolderPath('c', names, parents, new Set())).toBe('Work/Meetings/Q3')
    })

    test('top level and trash resolve to the root', () => {
        expect(resolveFolderPath('', names, parents, new Set())).toBe('')
        expect(resolveFolderPath('trash', names, parents, new Set())).toBe('')
    })

    test('refuses a path when a folder in the chain could not be read', () => {
        // A shortened path would write the notebook into the wrong vault folder.
        expect(resolveFolderPath('c', names, parents, new Set(['a']))).toBeNull()
        expect(resolveFolderPath('c', names, parents, new Set(['c']))).toBeNull()
    })

    test('a genuinely absent parent ends the chain as before', () => {
        const orphanParents = new Map([...parents, ['a', 'gone']])
        expect(resolveFolderPath('c', names, orphanParents, new Set())).toBe('Work/Meetings/Q3')
    })

    test('a cycle terminates', () => {
        const cyclic = new Map([
            ['a', 'b'],
            ['b', 'a']
        ])
        expect(resolveFolderPath('b', names, cyclic, new Set())).toBe('Work/Meetings')
    })
})
