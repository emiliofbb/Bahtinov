# Deploying to GitHub Pages

The app is a single, fully self-contained `index.html` — all JavaScript (geometry,
mask generation, STL/SVG export, and the vendored earcut triangulator) is inlined.
It needs **no server, no build step, and no runtime dependencies**, so deploying to
GitHub Pages is just "put `index.html` in a repo and turn Pages on."

## Option A — deploy only the built file (recommended)

You only need the one file.

1. Create a new repository on GitHub (e.g. `bahtinov-generator`).

2. In your local project directory, copy `index.html` to a clean folder:

   ```bash
   mkdir pages && cp index.html pages/
   ```

3. Push it as the repo root (or under `docs/`):

   ```bash
   cd pages
   git init
   git add index.html
   git commit -m "Bahtinov mask generator"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/bahtinov-generator.git
   git push -u origin main
   ```

4. Enable Pages:
   - Repo → **Settings** → **Pages**.
   - **Source** → **Deploy from a branch**.
   - **Branch** → `main` and folder **`/ (root)`** (or `/docs` if you used that).
   - Click **Save**.

5. Wait a minute, then open:

   ```
   https://YOUR_USERNAME.github.io/bahtinov-generator/
   ```

That's it. The default `index.html` loads automatically.

## Option B — deploy the whole repo (source + build)

Useful if you want others to be able to rebuild after editing the source modules.

1. Push everything (the repo root already contains `index.html`):

   ```bash
   git init
   git add index.html geometry.js mask.js stl.js app.js build.js index.template.html README.md _original/earcut.js
   git commit -m "Initial import"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/bahtinov-generator.git
   git push -u origin main
   ```

2. Enable Pages exactly as in Option A (branch `main`, folder `/ (root)`).

GitHub Pages serves `index.html`; the `.js` source files are ignored at runtime
(everything is already bundled into `index.html`).

### Note on Jekyll

GitHub Pages runs Jekyll by default, which skips directories whose names begin
with an underscore (so `_original/` won't be published). That's harmless — the
vendored `earcut.js` is only needed by `node build.js`, never at runtime. If you
prefer, add an empty `.nojekyll` file to the root to disable Jekyll entirely.

## Rebuilding after changes

If you edit `geometry.js`, `mask.js`, `stl.js`, `app.js`, or `index.template.html`,
regenerate the bundle and commit the result:

```bash
node build.js        # writes index.html
git add index.html
git commit -m "Update app"
git push
```

`build.js` requires Node.js (any recent version). It concatenates the source
modules and inlines the vendored earcut library — no npm install needed.

## Custom domain (optional)

Repo → **Settings** → **Pages** → **Custom domain**, then point a `CNAME` record
at `YOUR_USERNAME.github.io`. A `CNAME` file will be written to the repo root;
keep it committed so it isn't lost on the next Pages deploy.
