// SPDX-License-Identifier: MIT
/**
 * LOESS smoother with a pointwise confidence band.
 *
 * A trend line on this scatter is a hazard: Spearman rho between log speaker
 * count and cost is about -0.29, and a bare curve would be read as far stronger
 * than that. So the curve never ships without its band — the band's width *is*
 * the honesty. Where the data barely constrains the fit, the band is wide
 * enough to say so without the reader needing to know what rho means.
 *
 * Local linear regression with tricube weights, the standard LOESS recipe. The
 * band is a pointwise 95% interval built from the local residual variance and
 * the effective local sample size, so it widens exactly where points are sparse
 * — the right tail here, which is where the eye most wants to over-read.
 */

export interface SmoothPoint {
  x: number;
  y: number;
  lo: number;
  hi: number;
}

const TRICUBE = (u: number): number => {
  const a = 1 - Math.abs(u) ** 3;
  return a > 0 ? a ** 3 : 0;
};

/**
 * @param xs        predictor, already on the scale you want to smooth over
 * @param ys        response
 * @param bandwidth fraction of points in each local neighbourhood (0..1]
 * @param steps     number of points on the output curve
 */
export function loess(
  xs: number[],
  ys: number[],
  bandwidth = 0.55,
  steps = 60
): SmoothPoint[] {
  const n = xs.length;
  if (n < 8) return [];

  const order = [...xs.keys()].sort((a, b) => xs[a] - xs[b]);
  const X = order.map((i) => xs[i]);
  const Y = order.map((i) => ys[i]);

  const span = Math.max(3, Math.min(n, Math.floor(bandwidth * n)));
  const min = X[0];
  const max = X[n - 1];
  const out: SmoothPoint[] = [];

  for (let s = 0; s < steps; s += 1) {
    const x0 = min + ((max - min) * s) / (steps - 1);

    // Neighbourhood: the `span` closest points, and the distance to the
    // farthest of them sets the kernel width.
    const distances = X.map((x, i) => ({ i, d: Math.abs(x - x0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, span);
    const maxDistance = distances[distances.length - 1].d || 1e-9;

    let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
    for (const { i, d } of distances) {
      const w = TRICUBE(d / maxDistance);
      if (w <= 0) continue;
      sw += w;
      swx += w * X[i];
      swy += w * Y[i];
      swxx += w * X[i] * X[i];
      swxy += w * X[i] * Y[i];
    }
    if (sw === 0) continue;

    const denom = sw * swxx - swx * swx;
    const slope = Math.abs(denom) < 1e-12 ? 0 : (sw * swxy - swx * swy) / denom;
    const intercept = (swy - slope * swx) / sw;
    const yHat = intercept + slope * x0;

    // Local residual variance, weighted, with the effective sample size from
    // the weights rather than the raw count.
    let ssq = 0;
    let sumW = 0;
    let sumW2 = 0;
    for (const { i, d } of distances) {
      const w = TRICUBE(d / maxDistance);
      if (w <= 0) continue;
      const resid = Y[i] - (intercept + slope * X[i]);
      ssq += w * resid * resid;
      sumW += w;
      sumW2 += w * w;
    }
    const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 1;
    const variance = sumW > 2 ? ssq / (sumW - 2) : ssq / Math.max(sumW, 1);
    const se = Math.sqrt(Math.max(variance, 0) / Math.max(effectiveN, 1));

    out.push({ x: x0, y: yHat, lo: yHat - 1.96 * se, hi: yHat + 1.96 * se });
  }
  return out;
}
