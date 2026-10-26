/** A box as Playwright reports it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What moved, if anything, between the skeleton frame and the loaded frame. */
export interface GeometryDiff {
  stable: boolean;
  dx: number;
  dy: number;
  dHeight: number;
  dWidth: number;
}

/**
 * Compares the shell's box while the skeleton shows with its box after the content loaded (SPEC P7.1). A shift or a
 * height change above the tolerance is the WMS title jump: a fast page that visibly jumps.
 * @param tolerancePx default 2 px (sub-pixel layout and font hinting stay inside it)
 */
export function compareGeometry(during: Box, after: Box, tolerancePx = 2): GeometryDiff {
  const dx = Math.round((after.x - during.x) * 10) / 10;
  const dy = Math.round((after.y - during.y) * 10) / 10;
  const dHeight = Math.round((after.height - during.height) * 10) / 10;
  const dWidth = Math.round((after.width - during.width) * 10) / 10;
  const stable = [dx, dy, dHeight].every((d) => Math.abs(d) <= tolerancePx);
  return { stable, dx, dy, dHeight, dWidth };
}
