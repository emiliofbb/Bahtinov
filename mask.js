// mask.js — Bahtinov / Tri-Bahtinov mask geometry, faithful port of SkEye's algorithm.
// Works in Y-up math coordinates (origin at mask center). Uses geometry.js.

'use strict';

const G = (typeof require === 'function') ? require('./geometry.js') : (typeof geometry !== 'undefined' ? geometry : null);
const { rad, circlePoly, rectPoly, rotatePts, clipConvex, boolOp, unionMany, ensureCCW } = G;

// ---------- configuration / derived parameters ----------

function computeParams(inp) {
  const M = inp.diameterMM;
  const R = inp.rimWidthMM;
  const autoAperture = Math.max(0, M - 2 * R);
  const effectiveAperture = inp.useAutoAperture ? autoAperture : ((inp.specifiedAperture != null) ? inp.specifiedAperture : autoAperture);
  const stoppedAperture = (inp.apertureType === 0) ? effectiveAperture : effectiveAperture * (inp.apertureStopRatio || 1);
  const focal = inp.focalLengthMM;

  let recommendedRatio = 0;
  if (effectiveAperture > 0) recommendedRatio = 25.7 * (focal / stoppedAperture);

  let recommendedPitch = 0;
  if (recommendedRatio > 0) {
    const g = focal / recommendedRatio;       // = stoppedAperture / 25.7
    recommendedPitch = Math.round(g * 100) / 100;
    if (g < 1) recommendedPitch *= 3;
  }

  let pitch;
  if (inp.slitPitchMode === 'recommended') pitch = recommendedPitch;
  else if (inp.slitPitchMode === '3x') pitch = 3 * recommendedPitch;
  else pitch = (inp.slitPitchCustom != null) ? inp.slitPitchCustom : recommendedPitch;
  pitch = Math.max(0, pitch);

  return {
    maskDiameter: M,
    maskRadius: M / 2,
    aperture: effectiveAperture,
    apertureRadius: effectiveAperture / 2,
    stoppedAperture,
    recommendedRatio,
    recommendedPitch,
    pitch,
    slitRatio: inp.slitRatio,
    partitionMultiplier: inp.partitionMultiplier,
    centralObs: inp.centralObs,
    centralObsDia: inp.centralObsDiaMM,
    rounding: inp.rounding,
    maskType: inp.maskType,
  };
}

// ---------- rounded rectangle (for slit corner rounding) ----------

function roundedRectPoly(cx, cy, w, h, r, angle = 0, segments = 6) {
  const hw = w / 2, hh = h / 2;
  const cr = Math.min(r, hw, hh);
  const pts = [];
  if (cr <= 1e-6) {
    pts.push([-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]);
  } else {
    const ax = hw - cr, ay = hh - cr;
    const corners = [
      [ax, -ay, -Math.PI / 2, 0],          // bottom-right
      [ax, ay, 0, Math.PI / 2],            // top-right
      [-ax, ay, Math.PI / 2, Math.PI],     // top-left
      [-ax, -ay, Math.PI, 3 * Math.PI / 2] // bottom-left
    ];
    for (const [cx0, cy0, a0, a1] of corners) {
      for (let i = 0; i < segments; i++) {
        const a = a0 + (a1 - a0) * i / segments;
        pts.push([cx0 + cr * Math.cos(a), cy0 + cr * Math.sin(a)]);
      }
    }
  }
  let out = pts;
  if (angle) out = rotatePts(out, angle);
  return out.map(p => [p[0] + cx, p[1] + cy]);
}

// ---------- Bahtinov bar pattern (faithful port of `bp`) ----------

// n = aperture-or-diameter (varies by caller), r = radius (mask or aperture),
// partitionMult, o (boolean: true → f=0, false → f=l), cornerR = corner fillet radius
function bahtinovBars(pitch, slitRatio, n, r, partitionMult, o, cornerR = 0) {
  const hp = pitch / 2;
  const sw = slitRatio * pitch;
  const l = sw * partitionMult * 0.5;
  const f = o ? 0 : l;
  const u = r * 0.5;
  const bars = [];

  const m = n / pitch;
  const mk = (cx, cy, angle) => (cornerR > 0 ? roundedRectPoly(cx, cy, sw, n, cornerR, angle) : rectPoly(cx, cy, sw, n, angle));

  // middle vertical bars
  for (let k = 0; k < m / 2; k++) {
    const x = k * pitch + hp;
    bars.push(mk(x, r + l - f, 0));
    bars.push(mk(-x, r + l - f, 0));
  }

  // side bars (±20°), clipped to squares
  const g = r; // square size = r
  const rightSquare = rectPoly(u + l, -u - l - f, g, g);
  const leftSquare = rectPoly(-u - l, -u - l - f, g, g);

  for (let k = 0; k < m / 2; k++) {
    const x = k * pitch + hp;
    // +20° bars (rotate around origin)
    const rp = rotatePts(mk(x, -r, 0), rad(20));
    const rn = rotatePts(mk(-x, -r, 0), rad(20));
    const cp = clipConvex(rp, rightSquare);
    const cn = clipConvex(rn, rightSquare);
    if (cp.length >= 3) bars.push(cp);
    if (cn.length >= 3) bars.push(cn);
    // -20° bars
    const mp = rotatePts(mk(x, -r, 0), rad(-20));
    const mn = rotatePts(mk(-x, -r, 0), rad(-20));
    const cl = clipConvex(mp, leftSquare);
    const cr2 = clipConvex(mn, leftSquare);
    if (cl.length >= 3) bars.push(cl);
    if (cr2.length >= 3) bars.push(cr2);
  }

  return bars;
}

// ---------- Tri-Bahtinov V2 (faithful port of `Ik`) ----------

function triBahtinovBars(pitch, slitRatio, aperture, segments, centralObsDia) {
  const Ra = aperture / 2;
  const a = (aperture + centralObsDia) * 0.25;
  const sw = slitRatio * pitch;

  // bahtinov bars (r = aperture radius, partitionMult 1, o = false)
  const c = bahtinovBars(pitch, slitRatio, aperture, Ra, 1, false);

  const lbar = rectPoly(0, -Ra / 2, sw, Ra);
  const f = unionMany([
    circlePoly(0, 0, a + sw, segments),
    rotatePts(lbar, rad(60)),
    rotatePts(lbar, rad(-60)),
  ]);
  // u = sector(Ra, 210°..330°) - f
  const sectorBottom = circlePoly(0, 0, Ra, segments, rad(210), rad(330));
  const u = [];
  for (const fp of f) {
    const d = boolOp(sectorBottom, fp, 'diff');
    u.push(...d);
  }
  if (f.length === 0) u.push(sectorBottom);

  const hbar = rectPoly(0, -Ra / 2, sw / 2, Ra);
  const topBars = unionMany([rotatePts(hbar, rad(120)), rotatePts(hbar, rad(-120))]);
  const sectorTop = circlePoly(0, 0, a, segments, rad(29.99), rad(150));
  const m = [];
  for (const tp of topBars) {
    const d = boolOp(sectorTop, tp, 'diff');
    m.push(...d);
  }
  if (topBars.length === 0) m.push(sectorTop);

  const v = unionMany([...u, ...m]);

  // p = v ∩ c (clip v to bahtinov bars)
  let p = [];
  for (const vp of v) {
    for (const cb of c) {
      const it = boolOp(vp, cb, 'and');
      p.push(...it);
    }
  }

  // result = p ∪ rot120(p) ∪ rot-120(p)
  const p120 = p.map(poly => rotatePts(poly, rad(120)));
  const pn120 = p.map(poly => rotatePts(poly, rad(-120)));
  return unionMany([...p, ...p120, ...pn120]);
}

// ---------- apply rounding (corner fillet) to slit polygons ----------

function roundSlitCorners(bars, rounding, sw) {
  // We round corners at the mask level by replacing sharp corners with a small
  // fillet. Simpler approach used here: chamfer the slit rectangle corners is
  // applied during generation (roundedRectPoly). This function is a no-op hook.
  return bars;
}

// ---------- central obstruction handling ----------

function applyCentralObstruction(bars, params, sw) {
  const i = params.centralObsDia / 2;
  const clearance = circlePoly(0, 0, i + sw / 2, 180);
  const out = [];
  for (const bar of bars) {
    const d = boolOp(bar, clearance, 'diff');
    out.push(...d);
  }
  // the central obstruction itself becomes an open hole in the mask
  out.push(circlePoly(0, 0, i, 180));
  return out;
}

// ---------- build the full mask (outer ring + slit holes) ----------

function buildMask(inp) {
  const p = computeParams(inp);
  const sw = Math.max(0.05, p.pitch * p.slitRatio);
  const Rm = p.maskRadius;
  const cornerR = (p.rounding || 0) * sw / 2;

  const outer = circlePoly(0, 0, Rm, 360);

  // Guard against degenerate inputs (no slits when pitch/aperture is too small).
  if (p.pitch <= 0.1 || p.apertureRadius <= 0 || Rm <= 0) {
    return { params: p, outer, holes: [], sw, apertureCircle: circlePoly(0, 0, Math.max(1, p.apertureRadius), 180) };
  }

  let bars;
  if (p.maskType === 'Tri-Bahtinov V2') {
    const obs = p.centralObs ? p.centralObsDia : 0;
    bars = triBahtinovBars(p.pitch, p.slitRatio, p.aperture, 180, obs);
  } else {
    bars = bahtinovBars(p.pitch, p.slitRatio, p.maskDiameter, Rm, p.partitionMultiplier, true, cornerR);
  }

  // clip all bars to the aperture circle
  const apertureCircle = circlePoly(0, 0, p.apertureRadius, 180);
  let slits = [];
  for (const bar of bars) {
    const clipped = clipConvex(bar, apertureCircle);
    if (clipped.length >= 3) slits.push(clipped);
  }

  // central obstruction: trim slits to annulus and add central hole
  let holes = slits;
  if (p.centralObs && p.maskType === 'Bahtinov') {
    holes = applyCentralObstruction(slits, p, sw);
  }

  return { params: p, outer, holes, sw, apertureCircle };
}

// ---------- exports ----------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeParams, buildMask, bahtinovBars, triBahtinovBars, roundedRectPoly };
}
