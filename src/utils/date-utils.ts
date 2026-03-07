import { format } from 'date-fns'

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
