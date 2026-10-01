# Build Instructions

The shipped `index.html` is a **self-contained, single-file build** — all
JavaScript is inlined, so it runs straight from disk or a static host with no
build step. You only need to build when you edit a source module.

## Prerequisites

- **Node.js** (any recent version, ≥ 14). No `npm install` needed — there are
  zero npm dependencies.

## One-command build

```bash
node build.js
```

This reads the source modules, inlines everything (including the vendored
`_original/earcut.js` triangulator), and writes a fresh `index.html`.

## What `build.js` does

1. Concatenates the modules in dependency order:
   `geometry.js` → `_original/earcut.js` → `mask.js` → `stl.js` → `viewer.js` → `app.js`.
2. Strips the Node-only `module.exports` blocks and the `require('./geometry.js')`
   shims (in the browser bundle those functions are already top-level globals).
3. Injects the result into `index.template.html` at the `/*__BUNDLE__*/` marker.

## Source vs. build output

| File                  | Role                                              |
| --------------------- | ------------------------------------------------- |
| `geometry.js`         | 2D polygon core (clipping, boolean ops, triangulation) |
| `mask.js`             | Bahtinov / Tri-Bahtinov V2 slit generation        |
| `stl.js`              | Manifold mesh builder + binary STL serializer     |
| `viewer.js`           | Dependency-free WebGL mesh viewer                 |
| `app.js`              | SVG serialization + UI wiring                     |
| `index.template.html` | Markup + CSS (the `/*__BUNDLE__*/` placeholder)   |
| `_original/earcut.js` | Vendored mapbox/earcut (ISC license), inlined     |
| **`index.html`**      | **Build output — this is what you ship/open**     |

## Smoke test

After building, open `index.html` in a browser and confirm:

- The 2D preview shows ~58 slits (default Bahtinov mask).
- Switching **Output → 3D** shows the rotating WebGL viewport.
- **Download SVG** and **Download STL** both produce files.

For a scripted check of the geometry/STL (Node):

```bash
node -e "const {buildMask}=require('./mask.js'); const {buildSTL}=require('./stl.js'); const m=buildMask({diameterMM:100,rimWidthMM:10,useAutoAperture:true,apertureType:0,apertureStopRatio:1,focalLengthMM:1200,slitPitchMode:'recommended',slitRatio:0.5,partitionMultiplier:1,centralObs:false,rounding:0.3,maskType:'Bahtinov'}); console.log('slits', m.holes.length, 'tris', new DataView(buildSTL(m,5,{enabled:true,width:4,height:2}).buffer).getUint32(80,true));"
```
