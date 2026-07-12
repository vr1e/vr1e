// Font metrics for the card's monospace stack. The generator bakes the art's
// aspect ratio from these and the renderer lays it out with them, so they
// must live in exactly one place. After changing any of them, regenerate the
// art: npx tsx src/generate-ascii.ts <image> [columns]
export const charWidthEm = 0.6023; // Menlo advance width in em
export const artFontSize = 10;
export const artLineHeight = 11;
