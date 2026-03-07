import { format, parseISO } from 'date-fns'

/**
 * Format a date string for YAML frontmatter (ISO 8601)
 */
export function formatForFrontmatter(date: Date): string {
    return date.toISOString()
}

/**
 * Format a reMarkable lastModified timestamp for display
 * reMarkable uses milliseconds since epoch as a string
 */
export function formatRemarkableDate(lastModified: string): string {
    const timestamp = parseInt(lastModified, 10)
    if (isNaN(timestamp)) {
        return 'Unknown'
    }
    return format(new Date(timestamp), 'MMM d, yyyy HH:mm')
}

/**
 * Parse an ISO date string
 */
export function parseISODate(dateString: string): Date {
    return parseISO(dateString)
}
