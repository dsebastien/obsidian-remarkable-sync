import { PenType } from './notebook'

/**
 * Constants for the reMarkable .rm v6 binary file format
 */

export const RM_HEADER = 'reMarkable .lines file, version=6'
export const RM_HEADER_LENGTH = 43

/**
 * Page dimensions in pixels (reMarkable default)
 */
export const PAGE_WIDTH = 1404
export const PAGE_HEIGHT = 1872

/**
 * Scene tree block types in .rm v6 format (rmscene)
 *
 * Block header (8 bytes): uint32 length | uint8 unknown(0) | uint8 min_ver | uint8 cur_ver | uint8 type
 */
export enum BlockType {
    MigrationInfoBlock = 0x00,
    SceneTreeBlock = 0x01,
    TreeNodeBlock = 0x02,
    SceneGlyphItemBlock = 0x03,
    SceneGroupItemBlock = 0x04,
    /** Line items (strokes) */
    SceneLineItemBlock = 0x05,
    SceneTextItemBlock = 0x06,
    RootTextBlock = 0x07,
    SceneTombstoneItemBlock = 0x08,
    AuthorIdsBlock = 0x09,
    PageInfoBlock = 0x0a,
    SceneInfoBlock = 0x0d
}

/**
 * Tagged value wire types inside blocks
 */
export enum TagType {
    Byte1 = 0x1,
    Byte4 = 0x4,
    Byte8 = 0x8,
    Length4 = 0xc,
    ID = 0xf
}

/**
 * Scene item types inside value subblocks
 */
export enum SceneItemType {
    Group = 1,
    Line = 3
}

/** Block header size in bytes */
export const BLOCK_HEADER_SIZE = 8

/**
 * Maps StrokeColor enum values to CSS color strings
 */
export const STROKE_COLOR_MAP: Record<number, string> = {
    0: '#000000', // Black
    1: '#808080', // Grey
    2: '#FFFFFF', // White
    3: '#FFFF00', // Yellow
    4: '#00FF00', // Green
    5: '#FF69B4', // Pink
    6: '#0000FF', // Blue
    7: '#FF0000', // Red
    8: '#C0C0C0' // GreyOverlap
}

/**
 * Maps PenType to base width multiplier for rendering
 */
export const PEN_WIDTH_MULTIPLIER: Record<number, number> = {
    0: 1.2, // Brush
    1: 0.5, // TiltPencil
    2: 0.5, // BallPoint
    3: 0.9, // Marker
    4: 0.25, // Fineliner
    5: 3.5, // Highlighter
    6: 0, // Eraser (not rendered)
    7: 0.3, // SharpPencil
    8: 0, // EraseArea (not rendered)
    12: 1.2, // BrushV2
    13: 0.3, // SharpPencilV2
    14: 0.5, // TiltPencilV2
    15: 0.5, // BallPointV2
    16: 0.9, // MarkerV2
    17: 0.25, // FinelinerV2
    18: 3.5, // HighlighterV2
    21: 0.9 // CalligraphyPen
}

/**
 * PenType values that should use opacity for rendering (e.g., highlighter)
 */
export const HIGHLIGHTER_PEN_TYPES = new Set([PenType.Highlighter, PenType.HighlighterV2])

/**
 * PenType values that are erasers (should not be rendered)
 */
export const ERASER_PEN_TYPES = new Set([PenType.Eraser, PenType.EraseArea])
