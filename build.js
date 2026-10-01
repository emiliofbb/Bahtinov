// build.js — assemble the single-file index.html from the tested modules.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

let geometry = read('geometry.js');
let mask = read('mask.js');
let stl = read('stl.js');
let earcut = read('_original/earcut.js');
let viewer = read('viewer.js');
let app = read('app.js');

// Strip node-only module.exports blocks (guarded anyway, but keep the bundle clean).
function stripExports(src) {
  return src.replace(/\nif \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}$/, '');
}
geometry = stripExports(geometry);
mask = stripExports(mask);
stl = stripExports(stl);

// Remove the require-based imports; in the browser bundle the geometry functions are
// already top-level globals (from geometry.js above). Keeping the destructuring would
// redeclare `rad`, `circlePoly`, etc. and throw "already declared".
mask = mask.replace(
  /const G = \(typeof require === 'function'\) \? require\('\.\/geometry\.js'\) : \(typeof geometry !== 'undefined' \? geometry : null\);\n/,
  ''
).replace(
  /const \{ rad, circlePoly, rectPoly, rotatePts, clipConvex, boolOp, unionMany, ensureCCW \} = G;\n/,
  ''
);
stl = stl.replace(
  /const G = \(typeof require === 'function'\) \? require\('\.\/geometry\.js'\) : geometry;\n/,
  ''
).replace(
  /const \{ circlePoly \} = G;\n/,
  ''
).replace(/G\./g, '');

// geometry.js and mask.js both declare 'use strict' — fine, but we only need one.
// Build the browser namespace object that mask.js / stl.js look up via
// `typeof geometry !== 'undefined'`.
const GEOM_NAMES = [
  'TAU', 'EPS', 'rad', 'deg', 'polyArea', 'isCCW', 'reversePts', 'ensureCCW', 'ensureCW',
  'translate', 'rotatePts', 'circlePoly', 'rectPoly', 'clipConvex', 'boolOp',
  'unionPolygons', 'subtractPolygons', 'intersectPolygons', 'unionMany',
  'triangulatePolygonWithHoles', 'pointInTriangle',
];
const namespace = `\n// browser namespace expected by mask.js / stl.js\nconst geometry = { ${GEOM_NAMES.join(', ')} };\n`;

const htmlTemplate = read('index.template.html');

const bundle = geometry + '\n' + earcut + '\n' + namespace + '\n' + mask + '\n' + stl + '\n' + viewer + '\n' + app + '\n';

const out = htmlTemplate.replace('/*__BUNDLE__*/', bundle);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log('wrote index.html', (out.length / 1024).toFixed(1) + ' KB');
