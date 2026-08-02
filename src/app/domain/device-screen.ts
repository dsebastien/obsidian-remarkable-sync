/**
 * The screen a document was written on.
 *
 * This matters because `.rm` coordinates are screen pixels, and a PDF page is
 * placed at its true physical size. Converting a stroke to PDF points therefore
 * needs the device's resolution, which differs across the range.
 */
export interface DeviceScreen {
    /** Models sharing this screen, for diagnostics */
    readonly models: string
    readonly widthPx: number
    readonly heightPx: number
    /** Physical screen size in millimetres */
    readonly widthMm: number
    readonly heightMm: number
}

/**
 * The five reMarkable models, which between them have three screens.
 *
 * Sizes are the published figures. The resolutions double as the lookup key,
 * because a document records the screen it was written on rather than the model
 * name.
 */
export const DEVICE_SCREENS: readonly DeviceScreen[] = [
    {
        models: 'reMarkable 1, reMarkable 2, Paper Pure',
        widthPx: 1404,
        heightPx: 1872,
        widthMm: 157,
        heightMm: 209
    },
    {
        models: 'Paper Pro',
        widthPx: 1620,
        heightPx: 2160,
        widthMm: 180,
        heightMm: 240
    },
    {
        models: 'Paper Pro Move',
        widthPx: 954,
        heightPx: 1696,
        widthMm: 91,
        heightMm: 162
    }
] as const

/**
 * Used when a document does not say which screen it came from.
 *
 * The 1404x1872 screen covers three of the five models and every device sold
 * before the Paper Pro, so it is the least bad guess. Getting it wrong costs
 * about 0.6% against the Paper Pro and 15% against the Paper Pro Move.
 */
export const DEFAULT_DEVICE_SCREEN: DeviceScreen = DEVICE_SCREENS[0]!

/**
 * Identify the screen from the dimensions a document records.
 *
 * `.content` carries `customZoomPageWidth` and `customZoomPageHeight`, which
 * hold the screen size in pixels rather than anything about the page: the
 * sample, written on a reMarkable 2, records 1404x1872 with a
 * `customZoomCenterY` of 936, exactly half the screen height. Nothing else read
 * so far names the device.
 *
 * Falls back to {@link DEFAULT_DEVICE_SCREEN} when the fields are missing or
 * match no known screen, so an unrecognised future model still renders, just
 * with a small scale error.
 */
export function deviceScreenFor(widthPx?: number, heightPx?: number): DeviceScreen {
    if (!widthPx || !heightPx) {
        return DEFAULT_DEVICE_SCREEN
    }
    return (
        DEVICE_SCREENS.find(
            (screen) => screen.widthPx === widthPx && screen.heightPx === heightPx
        ) ?? DEFAULT_DEVICE_SCREEN
    )
}

const MM_PER_INCH = 25.4
const POINTS_PER_INCH = 72

/** A screen's real resolution, in dots per inch. */
export function deviceDpi(screen: DeviceScreen): number {
    return screen.widthPx / (screen.widthMm / MM_PER_INCH)
}

/**
 * One `.rm` unit in PDF points, for a given screen.
 *
 * A page is placed at its true physical size, so a screen pixel is a document
 * pixel: an 8.5 inch page is 8.5 x dpi units across. On the 1404x1872 screen
 * that is 227.14 dpi and 0.3170 pt per unit, which was measured from the
 * device's own thumbnail render as 0.317147 across a highlight rectangle and
 * 0.317162 between two of them.
 */
export function pointsPerRmUnit(screen: DeviceScreen): number {
    return POINTS_PER_INCH / deviceDpi(screen)
}
