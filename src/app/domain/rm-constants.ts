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
    /** A text highlight made by selecting text in a PDF */
    GlyphRange = 1,
    Group = 2,
    Line = 3
}

/** Block header size in bytes */
export const BLOCK_HEADER_SIZE = 8

/**
 * Maps StrokeColor enum values to CSS color strings.
 *
 * Values 9 to 13 come from firmware newer than the original nine. They matter
 * more than they look: an unmapped colour falls back to black in
 * `stroke-renderer`, and colour 9 is what the v2 highlighter uses, so a
 * highlighter stroke was painting a ~105px opaque black bar straight over the
 * writing it was meant to highlight. Confirmed against a real device export and
 * against rmscene's `PenColor` enum, which is the reference for the range.
 *
 * The 10-13 values are rmc's palette. Colour 9 is a default: the device stores
 * the exact highlight colour per notebook as an ARGB code in the `.content`
 * file's `extraMetadata` (`LastHighlighterv2ColorCode`), which the renderer does
 * not read yet. This default matches the code observed on a real device
 * (4294962549 = 0xFFFFED75).
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
    8: '#C0C0C0', // GreyOverlap
    9: '#FFED75', // Highlight (default; real colour lives in extraMetadata)
    10: '#A1D87D', // Green 2
    11: '#8BD0E5', // Cyan
    12: '#B782CD', // Magenta
    13: '#F7E851' // Yellow 2
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
 * Pens whose on-screen width is a constant rather than derived from the
 * stroke's own width values.
 *
 * Measured against a real export: multiplying the recorded width for these
 * produced a highlighter roughly ten times too wide (about 47pt against an 11pt
 * text line). The device draws them at a fixed nib size instead.
 */
/**
 * Tools the firmware knows about, from xochitl 3.27.1.0 and the per-tool colour
 * keys in a document's `.content` extraMetadata.
 *
 * Drawing tools with a known `.rm` tool id:
 *   Ballpoint(2) Ballpointv2(15) Marker(3) Markerv2(16) Fineliner(4)
 *   Finelinerv2(17) SharpPencil(7) SharpPencilv2(13) Pencil(1) Pencilv2(14)
 *   Paintbrush(0) Paintbrushv2(12) Highlighter(5) Highlighterv2(18)
 *   Calligraphy(21) Shader(23) Eraser(6) EraseArea(8)
 *
 * Present in the firmware with colour settings, but no tool id has been
 * observed in any `.rm` file, so they are deliberately not modelled:
 *   SolidPen, ReservedPen, ShadingMarker (the UI name for Shader), plus the
 *   non-drawing SelectionTool, ZoomTool, ClearPage and EraseSection.
 *
 * Unmapped ids in the 0-24 range: 9, 10, 11, 19, 20, 22, 24. An unknown id
 * falls back to a plain pen response rather than anything exotic, so a future
 * tool degrades instead of rendering wrongly.
 */
export const FIXED_WIDTH_PENS: Record<number, number> = {
    [PenType.Highlighter]: 15,
    [PenType.HighlighterV2]: 15,
    [PenType.Shader]: 12
}

/**
 * Default opacity per pen, used only when the stroke carries no ARGB alpha of
 * its own. Newer firmware supplies real alpha for the highlighter and shader,
 * so these are fallbacks for older files.
 */
export const PEN_DEFAULT_OPACITY: Record<number, number> = {
    [PenType.Highlighter]: 0.3,
    [PenType.HighlighterV2]: 0.3,
    [PenType.Shader]: 0.1,
    [PenType.SharpPencil]: 0.7,
    [PenType.SharpPencilV2]: 0.7,
    [PenType.EraseArea]: 0
}

/**
 * PenType values that are erasers (should not be rendered)
 */
export const ERASER_PEN_TYPES = new Set([PenType.Eraser, PenType.EraseArea])
