import uFuzzy from '@leeoniya/ufuzzy'

const fuzzyMatcher = new uFuzzy({
    interIns: 50,
    intraMode: 1,
    intraIns: 1,
    interSplit: '[^a-zA-Z0-9]+',
    intraSplit: '[a-zA-Z][0-9]|[0-9][a-zA-Z]|[a-z][A-Z]'
})

/**
 * Fuzzy match a query against a target string using uFuzzy.
 * Falls back to subsequence matching if uFuzzy finds no match.
 */
export function fuzzyMatch(query: string, target: string): boolean {
    const lowerQuery = query.toLowerCase()
    const lowerTarget = target.toLowerCase()

    const haystack = [lowerTarget]
    const idxs = fuzzyMatcher.filter(haystack, lowerQuery)

    if (idxs && idxs.length > 0) {
        return true
    }

    // Fallback: subsequence match
    let qi = 0
    for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti++) {
        if (lowerTarget[ti] === lowerQuery[qi]) {
            qi++
        }
    }
    return qi === lowerQuery.length
}
