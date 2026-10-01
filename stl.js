// stl.js — binary STL export for the mask (extrusion of the 2D cross-section).
// Produces a single manifold (watertight) solid, including an optional stepped
// flange collar. Uses the vendored mapbox earcut for triangulation.

'use strict';

const G = (typeof require === 'function') ? require('./geometry.js') : geometry;

function getEarcut() {
  if (typeof require === 'function') {
    const m = require('./_original/earcut.js');
    return m.default || m.earcut || m;
  }
  return (typeof earcut !== 'undefined') ? (earcut.default || earcut) : null;
}

// Triangulate a polygon-with-holes (polygons[0]=outer, rest=holes).
// Returns { verts: [[x,y],...], tris: [[i,j,k],...] }.
function triangulate(polygons) {
  const earcut = getEarcut();
  const data = [];
  const holeIndices = [];
  for (let i = 0; i < polygons.length; i++) {
    if (i > 0) holeIndices.push(data.length / 2);
    for (const p of polygons[i]) data.push(p[0], p[1]);
  }
  const idx = earcut(data, holeIndices, 2);
  const verts = [];
  for (let i = 0; i < data.length; i += 2) verts.push([data[i], data[i + 1]]);
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]]);
  return { verts, tris };
}

// Flat face at height z (triangulated). flip=false → +z normal, flip=true → −z normal.
function addFlatFace(tris, polygons, z, flip) {
  const { verts, tris: ft } = triangulate(polygons);
  for (const [a, b, c] of ft) {
    const A = [verts[a][0], verts[a][1], z];
    const B = [verts[b][0], verts[b][1], z];
    const C = [verts[c][0], verts[c][1], z];
    tris.push(flip ? [A, C, B] : [A, B, C]);
  }
}

// Vertical side wall for a ring spanning z ∈ [z0, z1].
// The ring must already be wound so the wall normal points away from the solid:
// CCW for outer walls, CW for inner/hole walls.
function addWall(tris, ring, z0, z1) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const A0 = [a[0], a[1], z0], B0 = [b[0], b[1], z0];
    const A1 = [a[0], a[1], z1], B1 = [b[0], b[1], z1];
    tris.push([A0, B0, B1]);
    tris.push([A0, B1, A1]);
  }
}

// Build a complete mask STL (binary ArrayBuffer).
// mask = { params:{maskRadius}, outer, holes }; flange = { enabled, width, height } or null.
function buildSTL(mask, heightMM, flange) {
  const tris = buildTriangles(mask, heightMM, flange);

  // ----- serialize as binary STL -----
  const n = tris.length;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let off = 84;
  const writeFloat = v => { dv.setFloat32(off, v, true); off += 4; };

  for (const tri of tris) {
    const [a, b, c] = tri;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    writeFloat(nx); writeFloat(ny); writeFloat(nz);
    writeFloat(a[0]); writeFloat(a[1]); writeFloat(a[2]);
    writeFloat(b[0]); writeFloat(b[1]); writeFloat(b[2]);
    writeFloat(c[0]); writeFloat(c[1]); writeFloat(c[2]);
    dv.setUint16(off, 0, true); off += 2;
  }
  return buf;
}

// Returns the mesh as an array of triangles, each [ [x,y,z], [x,y,z], [x,y,z] ].
// This is the same geometry serialized by buildSTL — reusable for WebGL rendering.
function buildTriangles(mask, heightMM, flange) {
  const H = Math.max(0.1, heightMM);
  const Rm = mask.params.maskRadius;
  const outer = mask.outer;   // CCW disk of radius Rm
  const holes = mask.holes;   // slit polygons (all within r ≤ apertureRadius < Rm)

  const hasFlange = !!(flange && flange.enabled && flange.width > 0 && flange.height > 0);
  const w = hasFlange ? flange.width : 0;
  const h = hasFlange ? flange.height : 0;
  const Rf = Rm + w;
  const seg = outer.length;                 // match the body's outer ring resolution
  const outerRf = G.circlePoly(0, 0, Rf, seg);

  const tris = [];

  // bottom face (z = 0), covering the flange footprint when present
  const bottomOuter = hasFlange ? outerRf : outer;
  addFlatFace(tris, [bottomOuter, ...holes], 0, true);

  if (hasFlange) {
    // flange top ring (annulus Rm..Rf) at z = h
    addFlatFace(tris, [outerRf, outer], h, false);
    // body top (disk Rm minus slits) at z = H
    addFlatFace(tris, [outer, ...holes], H, false);
    // flange outer wall r = Rf, z ∈ [0, h]
    addWall(tris, G.ensureCCW(outerRf), 0, h);
    // wall at r = Rm between the two top levels
    if (H >= h) {
      // body taller than flange → outer step wall, z ∈ [h, H]
      addWall(tris, G.ensureCCW(outer), h, H);
    } else {
      // flange taller than body → recessed well wall, z ∈ [H, h] (faces inward)
      addWall(tris, G.ensureCW(outer), H, h);
    }
  } else {
    // plain prism: top face + outer wall
    addFlatFace(tris, [outer, ...holes], H, false);
    addWall(tris, G.ensureCCW(outer), 0, H);
  }

  // slit / central-hole walls (z ∈ [0, H])
  for (const hole of holes) {
    addWall(tris, G.ensureCW(hole), 0, H);
  }

  return tris;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildSTL, buildTriangles, triangulate };
}
