// geometry.js — 2D polygon geometry core for the Bahtinov mask generator.
// Y-up math coordinates (origin at mask center), CCW = positive area.
// No external dependencies. CommonJS export for node testing.

'use strict';

const TAU = Math.PI * 2;
const EPS = 1e-9;

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }

// ---------- polygon helpers ----------

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

function isCCW(pts) { return polyArea(pts) > 0; }
function reversePts(pts) { return pts.slice().reverse(); }
function ensureCCW(pts) { return isCCW(pts) ? pts : reversePts(pts); }
function ensureCW(pts) { return isCCW(pts) ? reversePts(pts) : pts; }

function translate(pts, dx, dy) { return pts.map(p => [p[0] + dx, p[1] + dy]); }

// Rotate points around (cx,cy) [default origin] by `angle` radians (CCW).
function rotatePts(pts, angle, cx = 0, cy = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map(p => {
    const x = p[0] - cx, y = p[1] - cy;
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

// Full circle (CCW) or pie-slice sector (start/end in radians; sector includes center).
function circlePoly(cx, cy, r, n = 180, start = 0, end = TAU) {
  const sweep = end - start;
  const steps = Math.max(3, Math.round(n * sweep / TAU));
  const pts = [];
  if (Math.abs(sweep - TAU) < EPS) {
    for (let i = 0; i < steps; i++) {
      const a = start + sweep * i / steps;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  } else {
    pts.push([cx, cy]);
    for (let i = 0; i <= steps; i++) {
      const a = start + sweep * i / steps;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

// Rectangle centered at (cx,cy), width w, height h, rotated by angle around center.
function rectPoly(cx, cy, w, h, angle = 0) {
  const hw = w / 2, hh = h / 2;
  let pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  if (angle) pts = rotatePts(pts, angle);
  return translate(pts, cx, cy);
}

// ---------- Sutherland–Hodgman (subject clipped to CONVEX CCW clip polygon) ----------

function clipConvex(subject, clip) {
  let output = subject.slice();
  const n = clip.length;
  for (let i = 0; i < n; i++) {
    const a = clip[i], b = clip[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const input = output;
    output = [];
    if (input.length === 0) break;
    const inside = p => ex * (p[1] - a[1]) - ey * (p[0] - a[0]) >= -EPS;
    const isect = (p1, p2) => {
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
      const denom = ex * dy - ey * dx;
      if (Math.abs(denom) < EPS) return p2;
      const t = (ex * (a[1] - p1[1]) - ey * (a[0] - p1[0])) / denom;
      return [p1[0] + dx * t, p1[1] + dy * t];
    };
    let s = input[input.length - 1];
    for (const p of input) {
      if (inside(p)) {
        if (!inside(s)) output.push(isect(s, p));
        output.push(p);
      } else if (inside(s)) {
        output.push(isect(s, p));
      }
      s = p;
    }
  }
  return output;
}

// ---------- Greiner–Hormann boolean ----------

function segIntersection(a, b, c, d) {
  const d1x = b[0] - a[0], d1y = b[1] - a[1];
  const d2x = d[0] - c[0], d2y = d[1] - c[1];
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / denom;
  const u = ((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / denom;
  if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
    return { x: a[0] + d1x * t, y: a[1] + d1y * t, t, u };
  }
  return null;
}

// op: 'and' | 'or' | 'diff'. Returns array of result polygons.
// For 'diff', a hole is returned as a CW polygon alongside the CCW outer.
function boolOp(subject, clip, op) {
  const clipW = clip;
  const clipCCW = isCCW(clipW);
  const startEntry = (op === 'and');
  const clipForward = (op !== 'diff');
  const nS = subject.length, nC = clipW.length;

  const sI = [], cI = [];
  for (let i = 0; i < nS; i++) {
    const a = subject[i], b = subject[(i + 1) % nS];
    const list = [];
    for (let j = 0; j < nC; j++) {
      const it = segIntersection(a, b, clipW[j], clipW[(j + 1) % nC]);
      if (it) list.push(it);
    }
    list.sort((p, q) => p.t - q.t);
    sI.push(list);
  }
  for (let j = 0; j < nC; j++) {
    const c = clipW[j], d = clipW[(j + 1) % nC];
    const list = [];
    for (let i = 0; i < nS; i++) {
      const it = segIntersection(subject[i], subject[(i + 1) % nS], c, d);
      if (it) list.push(it);
    }
    list.sort((p, q) => p.u - q.u);
    cI.push(list);
  }
  const totalInts = sI.reduce((s, l) => s + l.length, 0);

  const S = [], C = [];
  for (let i = 0; i < nS; i++) {
    S.push({ x: subject[i][0], y: subject[i][1], int: false, entry: false, nei: null, vis: false, next: null, prev: null });
    for (const it of sI[i]) S.push({ x: it.x, y: it.y, int: true, entry: false, nei: null, vis: false, next: null, prev: null });
  }
  for (let j = 0; j < nC; j++) {
    C.push({ x: clipW[j][0], y: clipW[j][1], int: false, entry: false, nei: null, vis: false, next: null, prev: null });
    for (const it of cI[j]) C.push({ x: it.x, y: it.y, int: true, entry: false, nei: null, vis: false, next: null, prev: null });
  }
  for (let k = 0; k < S.length; k++) { S[k].next = S[(k + 1) % S.length]; S[k].prev = S[(k - 1 + S.length) % S.length]; }
  for (let k = 0; k < C.length; k++) { C[k].next = C[(k + 1) % C.length]; C[k].prev = C[(k - 1 + C.length) % C.length]; }

  const sInts = S.filter(n => n.int), cInts = C.filter(n => n.int);
  for (const sn of sInts) {
    let best = null, bestD = 1e-5;
    for (const cn of cInts) {
      if (cn.nei) continue;
      const dx = sn.x - cn.x, dy = sn.y - cn.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = cn; }
    }
    sn.nei = best;
    if (best) best.nei = sn;
  }
  for (const sn of sInts) {
    const cn = sn.nei; if (!cn) continue;
    const cex = cn.next.x - cn.prev.x, cey = cn.next.y - cn.prev.y;
    const sex = sn.next.x - sn.x, sey = sn.next.y - sn.y;
    const cross = cex * sey - cey * sex;
    sn.entry = clipCCW ? (cross > 0) : (cross < 0);
    cn.entry = sn.entry;
  }

  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      const it = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
      if (it) inside = !inside;
    }
    return inside;
  }

  if (totalInts === 0) {
    const sInC = pointInPolygon(subject[0], clipW);
    const cInS = pointInPolygon(clipW[0], subject);
    if (op === 'and') { if (sInC) return [subject]; if (cInS) return [clipW]; return []; }
    if (op === 'or') { if (sInC) return [clipW]; if (cInS) return [subject]; return [subject, clipW]; }
    if (sInC) return []; if (cInS) return [subject, reversePts(clipW)]; return [subject];
  }

  const maxIter = (S.length + C.length) * 8 + 50;
  function trace(start) {
    const poly = [];
    let cur = start, onS = true, n = 0;
    while (n++ < maxIter) {
      poly.push([cur.x, cur.y]);
      cur.vis = true;
      let nx = onS ? cur.next : (clipForward ? cur.next : cur.prev);
      if (nx.int) { cur = nx.nei; onS = !onS; }
      else { cur = nx; }
      if (cur === start) break;
    }
    return poly;
  }

  const results = [];
  for (const sn of sInts) {
    if (sn.entry === startEntry && !sn.vis) {
      const p = trace(sn);
      if (p.length >= 3 && Math.abs(polyArea(p)) > EPS) results.push(p);
    }
  }
  return results;
}

function unionPolygons(a, b) { return boolOp(a, b, 'or'); }
function subtractPolygons(a, b) { return boolOp(a, b, 'diff'); }
function intersectPolygons(a, b) { return boolOp(a, b, 'and'); }

// Union of a list of polygons into a set of disjoint polygons.
// Uses bbox pruning + a "merged iff result is a single polygon" heuristic that is
// exact for convex-ish shapes (the case we care about here).
function bboxOf(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, x1, y0, y1];
}
function bboxOverlap(a, b) { return a[0] <= b[1] + EPS && b[0] <= a[1] + EPS && a[2] <= b[3] + EPS && b[2] <= a[3] + EPS; }

function unionMany(polys) {
  if (polys.length === 0) return [];
  if (polys.length === 1) return [polys[0]];
  const result = [polys[0]];
  const boxes = [bboxOf(polys[0])];
  for (let k = 1; k < polys.length; k++) {
    const p = polys[k];
    const pb = bboxOf(p);
    let merged = false;
    for (let i = 0; i < result.length; i++) {
      if (!bboxOverlap(boxes[i], pb)) continue;
      const r = boolOp(result[i], p, 'or');
      if (r.length === 1) {
        result.splice(i, 1, ...r);
        boxes.splice(i, 1, ...r.map(bboxOf));
        merged = true;
        break;
      }
    }
    if (!merged) { result.push(p); boxes.push(pb); }
  }
  return result;
}

// ---------- ear-clipping triangulation (polygon with holes, Eberly bridging) ----------

function pointInTriangle(p, a, b, c) {
  // Strict inside test (points on the boundary do NOT block an ear).
  const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return (d1 > EPS && d2 > EPS && d3 > EPS) || (d1 < -EPS && d2 < -EPS && d3 < -EPS);
}

function _cross(ax, ay, bx, by) { return ax * by - ay * bx; }

// polygons: [outer (any winding), hole1, hole2, ...]
// returns { verts, tris } with tris as vertex-index triples into verts.
function triangulatePolygonWithHoles(polygons) {
  const outer = ensureCCW(polygons[0]).slice();
  const holes = polygons.slice(1).map(h => ensureCW(h).slice());

  const V = [];
  let ring = [];
  for (const p of outer) { V.push([p[0], p[1]]); ring.push(V.length - 1); }
  const holesIdx = holes.map(h => { const idx = []; for (const p of h) { V.push([p[0], p[1]]); idx.push(V.length - 1); } return idx; });

  // sort holes by rightmost-x descending
  holesIdx.sort((a, b) => {
    let am = -Infinity, bm = -Infinity;
    for (const i of a) if (V[i][0] > am) am = V[i][0];
    for (const i of b) if (V[i][0] > bm) bm = V[i][0];
    return bm - am;
  });

  function isReflex(vIdx) {
    const v = V[ring[vIdx]];
    const a = V[ring[(vIdx - 1 + ring.length) % ring.length]];
    const b = V[ring[(vIdx + 1) % ring.length]];
    return _cross(v[0] - a[0], v[1] - a[1], b[0] - v[0], b[1] - v[1]) < -EPS;
  }

  for (const hole of holesIdx) {
    let ri = 0;
    for (let i = 1; i < hole.length; i++) if (V[hole[i]][0] > V[hole[ri]][0]) ri = i;
    const M = V[hole[ri]];

    // ray-cast right from M
    let bestX = Infinity, bestEdge = -1;
    for (let i = 0; i < ring.length; i++) {
      const a = V[ring[i]], b = V[ring[(i + 1) % ring.length]];
      if ((a[1] > M[1] && b[1] > M[1]) || (a[1] < M[1] && b[1] < M[1])) continue;
      const dy = b[1] - a[1];
      if (Math.abs(dy) < EPS) continue; // horizontal edge: skip (degenerate ray case)
      const t = (M[1] - a[1]) / dy;
      if (t < -EPS || t > 1 + EPS) continue;
      const x = a[0] + t * (b[0] - a[0]);
      if (x < M[0] - EPS) continue;
      if (x < bestX) { bestX = x; bestEdge = i; }
    }
    if (bestEdge === -1) bestEdge = 0;
    const I0 = ring[bestEdge], I1 = ring[(bestEdge + 1) % ring.length];
    let bridgePos; // position in `ring` to connect the bridge to
    if (Math.abs(V[I0][1] - M[1]) < EPS && Math.abs(V[I0][0] - bestX) < EPS) bridgePos = bestEdge;
    else if (Math.abs(V[I1][1] - M[1]) < EPS && Math.abs(V[I1][0] - bestX) < EPS) bridgePos = (bestEdge + 1) % ring.length;
    else {
      let bestK = -1, bestDist = Infinity;
      for (let k = 0; k < ring.length; k++) {
        if (k === bestEdge || k === (bestEdge + 1) % ring.length) continue;
        if (!isReflex(k)) continue;
        const v = V[ring[k]];
        if (pointInTriangle(v, M, V[I0], V[I1])) {
          const d = (v[0] - M[0]) * (v[0] - M[0]) + (v[1] - M[1]) * (v[1] - M[1]);
          if (d < bestDist) { bestDist = d; bestK = k; }
        }
      }
      bridgePos = (bestK !== -1) ? bestK : (bestEdge + 1) % ring.length;
    }
    const ti = bridgePos;
    const merged = [];
    for (let i = 0; i <= ti; i++) merged.push(ring[i]);
    for (let i = 0; i < hole.length; i++) merged.push(hole[(ri + i) % hole.length]);
    merged.push(hole[ri]);
    for (let i = ti; i < ring.length; i++) merged.push(ring[i]);
    ring = merged;
  }

  // ear clip
  const tris = [];
  let cur = ring.slice();
  let guard = 0;
  while (cur.length > 3 && guard++ < 1000000) {
    const L = cur.length;
    let clipped = false;
    for (let i = 0; i < L; i++) {
      const i0 = cur[(i - 1 + L) % L], i1 = cur[i], i2 = cur[(i + 1) % L];
      const a = V[i0], b = V[i1], c = V[i2];
      const cc = _cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]);
      if (cc <= EPS) continue;
      let ear = true;
      for (let j = 0; j < L; j++) {
        if (j === (i - 1 + L) % L || j === i || j === (i + 1) % L) continue;
        if (pointInTriangle(V[cur[j]], a, b, c)) { ear = false; break; }
      }
      if (ear) { tris.push([i0, i1, i2]); cur.splice(i, 1); clipped = true; break; }
    }
    if (!clipped) break;
  }
  if (cur.length === 3) tris.push([cur[0], cur[1], cur[2]]);

  return { verts: V, tris };
}

// ---------- exports ----------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TAU, EPS, rad, deg, polyArea, isCCW, reversePts, ensureCCW, ensureCW,
    translate, rotatePts, circlePoly, rectPoly, clipConvex, boolOp,
    unionPolygons, subtractPolygons, intersectPolygons, unionMany,
    triangulatePolygonWithHoles, pointInTriangle,
  };
}
