// app.js — SVG serialization + UI wiring for the mask generator (browser).

// ---------- SVG serialization ----------

function polygonToPathD(pts, cx, cy) {
  // pts in mask space (Y-up, mm); convert to SVG (Y-down, origin at top-left of
  // a square of side `diameter` centered on the mask).
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const x = (cx + pts[i][0]).toFixed(3);
    const y = (cy - pts[i][1]).toFixed(3);
    d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
  }
  return d + 'Z';
}

function shapeToPathD(mask) {
  const diameter = mask.params.maskDiameter;
  const cx = diameter / 2, cy = diameter / 2;
  let paths = '';
  paths += polygonToPathD(mask.outer, cx, cy);
  for (const h of mask.holes) paths += ' ' + polygonToPathD(h, cx, cy);
  return paths;
}

function shapeToSVG(mask) {
  const diameter = mask.params.maskDiameter;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${diameter.toFixed(4)}mm" height="${diameter.toFixed(4)}mm" viewBox="0 0 ${diameter} ${diameter}"
     fill="black" fill-rule="evenodd" stroke="none"
     version="1.1" xmlns="http://www.w3.org/2000/svg">
  <path d="${shapeToPathD(mask)}"/>
</svg>`;
}

// ---------- helpers ----------

function $(sel) { return document.querySelector(sel); }
function fmt(v, d = 2) { return (Math.round(v * 100) / 100).toFixed(d); }

// ---------- 3D viewer ----------

let viewer = null;

function currentFlange() {
  return {
    enabled: state.hasFlange,
    width: +state.flangeWidthMM,
    height: +state.flangeHeightMM,
  };
}

function meshBounds(tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let i = 0; i < 3; i++) {
    if (p[i] < mn[i]) mn[i] = p[i];
    if (p[i] > mx[i]) mx[i] = p[i];
  }
  const center = [0, 1, 2].map(i => (mn[i] + mx[i]) / 2);
  const ext = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
  return { center, scale: 2.0 / ext };
}

function render3D() {
  if (!viewer || !lastMask) return;
  const tris = buildTriangles(lastMask, +state.heightMM, currentFlange());
  if (!tris.length) { viewer.setMesh([], [0, 0, 0], 1); viewer.render(); return; }
  const { center, scale } = meshBounds(tris);
  viewer.setMesh(tris, center, scale);
  viewer.render();
}

// ---------- state ----------

const state = {
  apertureType: 0,          // 0 = fully open, 1 = stopped
  apertureStopRatio: 1,
  maskType: 'Bahtinov',
  outputType: '2D',         // '2D' | '3D'
  diameterMM: 100,
  rimWidthMM: 10,
  useAutoAperture: true,
  specifiedAperture: null,
  focalLengthMM: 1200,
  slitPitchMode: 'recommended',
  slitPitchCustom: null,
  slitRatio: 0.5,
  partitionMultiplier: 1,
  centralObs: false,
  centralObsDiaMM: 30,
  rounding: 0.3,
  // 3D
  heightMM: 5,
  hasFlange: true,
  flangeHeightMM: 2,
  flangeWidthMM: 4,
};

function currentConfig() {
  return {
    diameterMM: +state.diameterMM,
    rimWidthMM: +state.rimWidthMM,
    useAutoAperture: state.useAutoAperture,
    specifiedAperture: state.specifiedAperture,
    apertureType: state.apertureType,
    apertureStopRatio: +state.apertureStopRatio,
    focalLengthMM: +state.focalLengthMM,
    slitPitchMode: state.slitPitchMode,
    slitPitchCustom: state.slitPitchCustom,
    slitRatio: +state.slitRatio,
    partitionMultiplier: +state.partitionMultiplier,
    centralObs: state.centralObs,
    centralObsDiaMM: +state.centralObsDiaMM,
    rounding: +state.rounding,
    maskType: state.maskType,
  };
}

// ---------- render ----------

let lastMask = null;

function render() {
  const cfg = currentConfig();
  const params = computeParams(cfg);
  const mask = buildMask(cfg);
  lastMask = mask;

  // update derived value labels
  $('#valAutoAperture').textContent = fmt(params.aperture, 2);
  $('#valRecommendedPitch').textContent = fmt(params.recommendedPitch, 2);
  $('#val3xPitch').textContent = fmt(3 * params.recommendedPitch, 2);
  $('#valStoppedAperture').textContent = fmt(params.stoppedAperture, 2);

  // preview — build the path directly into the SVG element (no nested <svg>)
  const svgEl = $('#previewSvg');
  let pathEl = svgEl.querySelector('path');
  if (!pathEl) {
    pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgEl.appendChild(pathEl);
  }
  pathEl.setAttribute('d', shapeToPathD(mask));
  pathEl.setAttribute('fill', 'black');
  pathEl.setAttribute('fill-rule', 'evenodd');
  svgEl.setAttribute('viewBox', `0 0 ${params.maskDiameter} ${params.maskDiameter}`);

  // stats
  $('#statHoles').textContent = mask.holes.length;
  $('#statPitch').textContent = fmt(params.pitch, 2) + ' mm';
  $('#statAperture').textContent = fmt(params.aperture, 2) + ' mm';

  // 3D viewport (only when in 3D output mode)
  if (state.outputType === '3D') render3D();
}

// ---------- downloads ----------

function downloadSVG() {
  const svg = shapeToSVG(lastMask);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  triggerDownload(blob, 'bahtinov-mask.svg');
}

function downloadSTL() {
  const height = +state.heightMM;
  const flange = {
    enabled: state.hasFlange,
    width: +state.flangeWidthMM,
    height: +state.flangeHeightMM,
    maskRadius: lastMask.params.maskRadius,
  };
  const buf = buildSTL(lastMask, height, flange);
  const blob = new Blob([buf], { type: 'model/stl' });
  triggerDownload(blob, 'bahtinov-mask.stl');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- UI wiring ----------

function wire() {
  // number inputs
  const bindNum = (sel, key) => {
    const el = $(sel);
    el.addEventListener('input', () => { state[key] = el.value; render(); });
  };
  bindNum('#inM', 'diameterMM');
  bindNum('#inR', 'rimWidthMM');
  bindNum('#inF', 'focalLengthMM');
  bindNum('#inSlitRatio', 'slitRatio');
  bindNum('#inCentralObsDia', 'centralObsDiaMM');
  bindNum('#inHeight', 'heightMM');
  bindNum('#inFlangeHeight', 'flangeHeightMM');
  bindNum('#inFlangeWidth', 'flangeWidthMM');
  bindNum('#inApertureStop', 'apertureStopRatio');

  // aperture radio
  document.querySelectorAll('input[name="apertureMode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.useAutoAperture = (r.value === 'auto');
      $('#customAperture').classList.toggle('hidden', state.useAutoAperture);
      render();
    });
  });
  $('#inCustomAperture').addEventListener('input', e => { state.specifiedAperture = e.target.value; render(); });

  // slit pitch radio
  document.querySelectorAll('input[name="pitchMode"]').forEach(r => {
    r.addEventListener('change', () => {
      state.slitPitchMode = r.value;
      $('#customPitch').classList.toggle('hidden', r.value !== 'custom');
      render();
    });
  });
  $('#inCustomPitch').addEventListener('input', e => { state.slitPitchCustom = +e.target.value; render(); });

  // select-like dropdowns (aperture type, mask type, output type)
  $('#apertureType').addEventListener('change', e => {
    state.apertureType = +e.target.value;
    $('#apertureStopRow').classList.toggle('hidden', state.apertureType === 0);
    render();
  });
  $('#maskType').addEventListener('change', e => { state.maskType = e.target.value; render(); });
  $('#outputType').addEventListener('change', e => {
    state.outputType = e.target.value;
    applyOutputMode();
    render();
  });

  // central obstruction
  $('#inCentralObs').addEventListener('change', e => {
    state.centralObs = e.target.checked;
    $('#centralObsRow').classList.toggle('hidden', !e.target.checked);
    render();
  });

  // rounding slider
  const roundSlider = $('#inRounding');
  roundSlider.addEventListener('input', () => {
    state.rounding = +roundSlider.value;
    $('#valRounding').textContent = Math.round(state.rounding * 100) + '%';
    render();
  });

  // flange
  $('#inFlange').addEventListener('change', e => {
    state.hasFlange = e.target.checked;
    $('#flangeRows').classList.toggle('hidden', !e.target.checked);
    render();
  });

  // partition multiplier
  $('#inPartition').addEventListener('input', e => { state.partitionMultiplier = +e.target.value; render(); });

  // download
  $('#btnDownload').addEventListener('click', () => {
    if (state.outputType === '2D') downloadSVG();
    else downloadSTL();
  });

  // help modal
  const helpModal = $('#helpModal');
  const openHelp = () => helpModal.classList.remove('hidden');
  const closeHelp = () => helpModal.classList.add('hidden');
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnHelpClose').addEventListener('click', closeHelp);
  helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !helpModal.classList.contains('hidden')) closeHelp(); });

  window.addEventListener('resize', render);
}

// ---------- output mode + DOM sync ----------

function applyOutputMode() {
  const is3D = state.outputType === '3D';
  $('#settings3D').classList.toggle('hidden', !is3D);
  $('#btnDownload').textContent = is3D ? 'Download STL' : 'Download SVG';
  $('#previewSvg').classList.toggle('hidden', is3D);
  $('#viewer3D').classList.toggle('hidden', !is3D);
  if (is3D) {
    if (!viewer) {
      viewer = createMeshViewer($('#viewerCanvas'));
      if (!viewer) $('#errMsg').textContent = 'WebGL not available — 3D preview disabled.';
    }
    // defer so the canvas has a non-zero size after it is unhidden
    requestAnimationFrame(() => render3D());
  }
}

// Re-read the actual DOM values into state and re-sync visibility. This fixes the
// case where the browser restores form state on reload (the <select> shows "3D"
// but the JS still thinks it is in 2D mode).
function syncFromDOM() {
  state.outputType = $('#outputType').value;
  state.maskType = $('#maskType').value;
  state.apertureType = +$('#apertureType').value;
  state.apertureStopRatio = $('#inApertureStop').value;
  state.diameterMM = $('#inM').value;
  state.rimWidthMM = $('#inR').value;
  state.focalLengthMM = $('#inF').value;
  state.slitRatio = $('#inSlitRatio').value;
  state.partitionMultiplier = $('#inPartition').value;
  state.centralObsDiaMM = $('#inCentralObsDia').value;
  state.heightMM = $('#inHeight').value;
  state.flangeHeightMM = $('#inFlangeHeight').value;
  state.flangeWidthMM = $('#inFlangeWidth').value;
  state.rounding = +$('#inRounding').value;
  state.centralObs = $('#inCentralObs').checked;
  state.hasFlange = $('#inFlange').checked;
  state.specifiedAperture = $('#inCustomAperture').value;
  state.slitPitchCustom = +$('#inCustomPitch').value;

  const apMode = document.querySelector('input[name="apertureMode"]:checked');
  state.useAutoAperture = !apMode || apMode.value === 'auto';
  const pMode = document.querySelector('input[name="pitchMode"]:checked');
  state.slitPitchMode = pMode ? pMode.value : 'recommended';

  // visibility sync
  applyOutputMode();
  $('#apertureStopRow').classList.toggle('hidden', state.apertureType === 0);
  $('#customAperture').classList.toggle('hidden', state.useAutoAperture);
  $('#customPitch').classList.toggle('hidden', state.slitPitchMode !== 'custom');
  $('#centralObsRow').classList.toggle('hidden', !state.centralObs);
  $('#flangeRows').classList.toggle('hidden', !state.hasFlange);
  $('#valRounding').textContent = Math.round(state.rounding * 100) + '%';
}

wire();
syncFromDOM();
render();
// Re-sync when the page is restored from the back/forward cache (form state persists
// there too, and can arrive after the initial script run).
window.addEventListener('pageshow', () => { syncFromDOM(); render(); });
