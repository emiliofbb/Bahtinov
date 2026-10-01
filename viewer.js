// viewer.js — minimal, dependency-free WebGL mesh viewer with orbit controls.
// Renders a list of triangles (flat-shaded) so the user can inspect the 3D mask.

function createMeshViewer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;

  // ---------- shaders ----------
  const VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'uniform mat4 uMVP;',
    'uniform mat4 uModel;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vNormal = mat3(uModel) * aNormal;',
    '  gl_Position = uMVP * vec4(aPos, 1.0);',
    '}',
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'uniform vec3 uColor;',
    'void main() {',
    '  vec3 n = normalize(vNormal);',
    '  vec3 l1 = normalize(vec3(0.5, 0.65, 0.55));',
    '  vec3 l2 = normalize(vec3(-0.5, -0.3, -0.75));',
    '  float d1 = max(dot(n, l1), 0.0);',
    '  float d2 = max(dot(n, l2), 0.0);',
    '  float l = 0.30 + 0.55 * d1 + 0.25 * d2;',
    '  gl_FragColor = vec4(uColor * l, 1.0);',
    '}',
  ].join('\n');

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('shader compile:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('shader link:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    normal: gl.getAttribLocation(prog, 'aNormal'),
    mvp: gl.getUniformLocation(prog, 'uMVP'),
    model: gl.getUniformLocation(prog, 'uModel'),
    color: gl.getUniformLocation(prog, 'uColor'),
  };

  // ---------- buffers ----------
  const posBuf = gl.createBuffer();
  const normBuf = gl.createBuffer();
  let vertexCount = 0;

  // ---------- mat4 helpers (column-major, like WebGL) ----------
  function identity(o) { for (let i = 0; i < 16; i++) o[i] = (i % 5 === 0) ? 1 : 0; }
  function multiply(o, a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + 4 * k] * b[k + 4 * j];
      r[i + 4 * j] = s;
    }
    o.set(r);
  }
  function perspective(o, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf;
  }
  function translateScale(o, cx, cy, cz, s) {
    // o = translate(-c) * scale(s)  =>  o * p = s*(p - c)
    o.fill(0);
    o[0] = s; o[5] = s; o[10] = s; o[15] = 1;
    o[12] = -s * cx; o[13] = -s * cy; o[14] = -s * cz;
  }
  function rotationX(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
  }
  function rotationY(o, a) {
    const c = Math.cos(a), s = Math.sin(a);
    identity(o);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
  }

  // ---------- orbit state ----------
  let yaw = 0.6, pitch = -0.35, dist = 2.6;
  let dragging = false;
  let lastX = 0, lastY = 0;
  const pointers = new Map(); // for pinch

  // ---------- mesh ----------
  function setMesh(tris, center, scale) {
    const pos = [], norm = [];
    for (const [a, b, c] of tris) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const p of [a, b, c]) {
        pos.push(p[0], p[1], p[2]);
        norm.push(nx, ny, nz);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norm), gl.STATIC_DRAW);
    vertexCount = pos.length / 3;

    // store for model matrix
    meshCenter = center;
    meshScale = scale;
  }
  let meshCenter = [0, 0, 0], meshScale = 1;

  // ---------- render ----------
  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.07, 0.10, 0.14, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (vertexCount === 0) return;

    const aspect = w / h;
    const P = new Float32Array(16);
    perspective(P, 45 * Math.PI / 180, aspect, 0.01, 100);

    const RX = new Float32Array(16), RY = new Float32Array(16), V = new Float32Array(16), T = new Float32Array(16);
    rotationX(RX, pitch);
    rotationY(RY, yaw);
    multiply(V, RX, RY);
    // translate camera back by dist along -z (in view space)
    V[14] -= dist;

    const M = new Float32Array(16);
    translateScale(M, meshCenter[0], meshCenter[1], meshCenter[2], meshScale);

    const VM = new Float32Array(16), MVP = new Float32Array(16);
    multiply(VM, V, M);
    multiply(MVP, P, VM);

    gl.uniformMatrix4fv(loc.mvp, false, MVP);
    gl.uniformMatrix4fv(loc.model, false, M);
    gl.uniform3f(loc.color, 0.62, 0.78, 0.90);

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.enableVertexAttribArray(loc.normal);
    gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  // ---------- interaction ----------
  function onDown(e) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw += dx * 0.008;
    pitch -= dy * 0.008;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    render();
  }
  function onUp(e) { dragging = false; }
  function onWheel(e) {
    e.preventDefault();
    dist *= Math.exp(e.deltaY * 0.001);
    dist = Math.max(1.2, Math.min(12, dist));
    render();
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';

  function dispose() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
  }

  return { setMesh, render, dispose };
}
