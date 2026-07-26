/**
 * Output-quality knobs shared by every export path, so a PNG and a GIF of the same scene
 * can never be rendered at different fidelity.
 */

/**
 * Render at this multiple of the output size, then box-filter down. GIF and PNG both end
 * up as flat pixels with no vector information, so whatever anti-aliasing exists at render
 * time is final — supersampling is what turns a hard 1-bit-looking glyph edge into a clean
 * one. 2× is the point of diminishing returns here: 3× costs 2.25× the pixels for a
 * difference that is not visible at these font sizes.
 */
export const SUPERSAMPLE = 2

/**
 * GIF frame rate. Snapped to a centisecond-exact delay by the encoder (see
 * gifExport.snapDelayMs), so 20fps is a true 50ms delay rather than a rounded one.
 */
export const GIF_FPS = 20
