# Bahtinov Mask Generator

A modern, dependency-free, fully client-side replacement for the SkEye
Bahtinov mask generator. It reproduces the original's geometry (Bahtinov and
Tri-Bahtinov V2) and exports both 2D (SVG) and 3D (STL) output, with no server
and no build step required to use.

## Use

Open `index.html` in any modern browser. That's the whole app — no server,
no upload, no dependencies fetched at runtime.

See **[GITHUB_PAGES.md](GITHUB_PAGES.md)** for step-by-step instructions to
publish it on GitHub Pages (it's just one static file, so it's a two-minute setup).

- **Mask type** — Bahtinov (focussing) or Tri-Bahtinov V2 (focussing + collimation).
- **Output** — 2D SVG (for paper/vinyl cutting) or 3D STL (for printing).
- **M / R / A** — mask diameter, rim width, aperture (auto = M − 2R, or custom).
- **F** — focal length (drives the recommended slit pitch and stopped aperture).
- **S** — slit pitch: recommended, 3× (third-order spikes), or custom.
- **Central obstruction** — for reflectors; adds a central hole with a clearance ring.
- **Rounding** — fillet radius on the slit corners.
- **Advanced** — slit ratio (bar/gap duty cycle) and partition multiplier.
- **3D** — mask thickness and an optional flange (collar) around the rim.

The 2D preview is live. In **3D output mode** a WebGL viewport shows the actual
solid (drag to rotate, scroll to zoom) — no library is loaded, it's a small
built-in renderer. The STL is a single manifold (watertight) solid with correct
outward normals, so it imports cleanly into FreeCAD and slices in Cura /
PrusaSlicer.

## Source layout

| File                 | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `index.html`         | Built single-file app (open this)                    |
| `geometry.js`        | 2D polygon primitives, clipping, boolean, triangulation |
| `mask.js`            | Bahtinov / Tri-Bahtinov geometry (port of the original) |
| `stl.js`             | Binary STL serialization + manifold mesh builder      |
| `viewer.js`          | Dependency-free WebGL mesh viewer (orbit + zoom)      |
| `app.js`             | SVG serialization + UI wiring                         |
| `index.template.html`| HTML/CSS template                                     |
| `build.js`           | Bundles the above into `index.html`                   |

## Rebuild

After editing any source file, regenerate the bundle (see **[BUILD.md](BUILD.md)**):

```
node build.js
```

## Notes

- The recommended slit pitch equals aperture ÷ 25.7 (the focal-length terms
  cancel algebraically), matching the original tool.
- Tri-Bahtinov V2 slit corners are not filleted (the Bahtinov slits are);
  this is the only intentional visual deviation from the original.
