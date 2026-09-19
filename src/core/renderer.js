// GPU pipeline: fullscreen triangle, HDR scene render target,
// bright pass -> separable gaussian bloom (quarter + eighth for cinematic)
// -> composite to screen. Handles WebGL2 context loss / restore.

import * as THREE from 'three';
import { SCENE_VERTEX, SCENE_FRAGMENT } from '../shaders/scene.js';
import { POST_VERTEX, BRIGHT_PASS_FRAGMENT, BLUR_FRAGMENT, COMPOSITE_FRAGMENT } from '../shaders/post.js';

export const TIER_SPECS = {
  standard:  { scale: 0.55, steps: 220, stepA: 0.085, dprCap: 1.5, cineBloom: false, blurPasses: 1 },
  high:      { scale: 0.78, steps: 340, stepA: 0.068, dprCap: 2.0, cineBloom: false, blurPasses: 2 },
  cinematic: { scale: 1.00, steps: 512, stepA: 0.052, dprCap: 2.0, cineBloom: true,  blurPasses: 2 },
};

const MOBILE_SCALE = { standard: 0.80, high: 0.72, cinematic: 0.66 };

function compileSceneShader(maxSteps, stepA) {
  return SCENE_FRAGMENT
    .replace('@@MAX_STEPS@@', String(maxSteps))
    .replace('@@STEP_A@@', String(stepA));
}

function makeRT(w, h, type, samples = 0) {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    samples,
  });
}

export class Pipeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false,
    });
    if (!this.gl) throw new Error('WebGL2 context unavailable');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: this.gl,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = true;

    const ext = this.gl.getExtension('EXT_color_buffer_float');
    this.halfFloatOK = !!ext;
    this.rtType = this.halfFloatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;

    // fullscreen triangle
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,
       3, -1, 0,
      -1,  3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0,
      2, 0,
      0, 2,
    ]), 2));
    this.quad = new THREE.Mesh(geo, null);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    this._buildMaterials();
    this._buildTargets(1, 1);

    this.onContextLost = null;
    this.onContextRestored = null;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.onContextLost) this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this._buildTargets(this.lastW, this.lastH);
      if (this.onContextRestored) this.onContextRestored();
    });
  }

  _buildMaterials() {
    this.sceneMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SCENE_VERTEX,
      fragmentShader: compileSceneShader(220, 0.085),
      uniforms: this._sceneUniforms(),
      depthTest: false,
      depthWrite: false,
    });
    this.brightMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POST_VERTEX,
      fragmentShader: BRIGHT_PASS_FRAGMENT,
      uniforms: { uTex: { value: null }, uThresh: { value: 1.1 } },
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POST_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: {
        uTex: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POST_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        uScene: { value: null },
        uBloomA: { value: null },
        uBloomE: { value: null },
        uBloomStr: { value: 1.25 },
        uVignette: { value: 0.38 },
        uGrain: { value: 0.12 },
        uExposure: { value: 1.15 },
        uTime: { value: 0 },
        uCine: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false, depthWrite: false,
    });
  }

  _sceneUniforms() {
    return {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3(0, 0, 7) },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uTanFov: { value: Math.tan(22.5 * Math.PI / 180) },
      uDebug: { value: 0 },
      uDiskRIn: { value: 3 }, uDiskROut: { value: 12 },
      uDiskH0: { value: 0.22 }, uDiskFlare: { value: 0.55 },
      uDiskOpacity: { value: 4 }, uDiskTemp: { value: 30000 },
      uDiskEmis: { value: 2 }, uDiskTurb: { value: 0.9 },
      uDiskTurbSpd: { value: 0.8 }, uDiskSwirl: { value: 0.9 },
      uDiskPrecess: { value: 0.06 },
      uDoppler: { value: 1 }, uRedshift: { value: 1 },
      uStars: { value: 1 }, uGalaxy: { value: 0.9 }, uDust: { value: 0.7 },
    };
  }

  _buildTargets(w, h) {
    this.lastW = w; this.lastH = h;
    for (const rt of [this.sceneRT, this.bloomA, this.bloomB, this.bloomE, this.bloomE2]) {
      if (rt) rt.dispose();
    }
    this.sceneRT = makeRT(w, h, this.rtType);
    const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    this.bloomA = makeRT(qw, qh, this.rtType);
    this.bloomB = makeRT(qw, qh, this.rtType);
    const ew = Math.max(2, w >> 3), eh = Math.max(2, h >> 3);
    this.bloomE = makeRT(ew, eh, this.rtType);
    this.bloomE2 = makeRT(ew, eh, this.rtType);
  }

  // ---- tier / resolution management ----
  setTier(tier, cssW, cssH, dpr, mobile) {
    const spec = TIER_SPECS[tier] || TIER_SPECS.high;
    this.tier = tier;
    this.tierSpec = spec;
    let scale = spec.scale;
    if (mobile) scale *= MOBILE_SCALE[tier];
    let dprCap = spec.dprCap;
    if (mobile) dprCap = Math.min(dprCap, 1.5);
    const dprEff = Math.min(dpr, dprCap);
    this.renderer.setPixelRatio(dprEff);
    const maxSide = 3200;
    let w = Math.max(2, Math.round(cssW * dprEff * scale));
    let h = Math.max(2, Math.round(cssH * dprEff * scale));
    if (Math.max(w, h) > maxSide) {
      const k = maxSide / Math.max(w, h);
      w = Math.round(w * k); h = Math.round(h * k);
    }
    this._buildTargets(w, h);
    this.sceneMat.uniforms.uRes.value.set(w, h);
    this.compMat.uniforms.uRes.value.set(w, h);

    // recompile scene shader with tier step budget + warm-up compile
    this.sceneMat.fragmentShader = compileSceneShader(spec.steps, spec.stepA);
    this.sceneMat.needsUpdate = true;
    this.quad.material = this.sceneMat;
    try {
      this.renderer.compile(this.scene, null);
    } catch {
      // lazy compile on first render is a safe fallback
    }
    return { w, h };
  }

  resize(cssW, cssH, dpr, mobile) {
    const spec = TIER_SPECS[this.tier || 'high'];
    const dprCap = mobile ? Math.min(spec.dprCap, 1.5) : spec.dprCap;
    this.renderer.setPixelRatio(Math.min(dpr, dprCap));
    this.renderer.setSize(cssW, cssH, false);
    this.setTier(this.tier || 'high', cssW, cssH, dpr, mobile);
  }

  // ---- per-frame ----
  renderFrame(camera, time, debug) {
    const u = this.sceneMat.uniforms;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    u.uCamPos.value.copy(camera.position);
    u.uCamFwd.value.copy(fwd);
    u.uCamRight.value.copy(right);
    u.uCamUp.value.copy(up);
    u.uTanFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    u.uTime.value = time;
    u.uDebug.value = debug;

    this.quad.material = this.sceneMat;
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.render(this.scene, camera);

    // bright pass
    this.brightMat.uniforms.uTex.value = this.sceneRT.texture;
    this.quad.material = this.brightMat;
    this.renderer.setRenderTarget(this.bloomA);
    this.renderer.render(this.scene, camera);

    // separable blurs at quarter res
    const spec = this.tierSpec;
    const passes = spec ? spec.blurPasses : 2;
    const qt = this.bloomA;
    this.blurMat.uniforms.uTexel.value.set(1 / qt.width, 1 / qt.height);
    for (let i = 0; i < passes; i++) {
      this.blurMat.uniforms.uTex.value = qt.texture;
      this.blurMat.uniforms.uDir.value.set(1, 0);
      this.quad.material = this.blurMat;
      this.renderer.setRenderTarget(this.bloomB);
      this.renderer.render(this.scene, camera);
      this.blurMat.uniforms.uTex.value = this.bloomB.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1);
      this.renderer.setRenderTarget(qt);
      this.renderer.render(this.scene, camera);
    }

    // cinematic: extra wide pass at eighth res
    let cine = 0;
    if (spec && spec.cineBloom) {
      const et = this.bloomE;
      this.blurMat.uniforms.uTexel.value.set(1 / et.width, 1 / et.height);
      this.blurMat.uniforms.uTex.value = this.bloomA.texture;
      this.blurMat.uniforms.uDir.value.set(1.6, 0);
      this.quad.material = this.blurMat;
      this.renderer.setRenderTarget(et);
      this.renderer.render(this.scene, camera);
      this.blurMat.uniforms.uTex.value = et.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1.6);
      this.renderer.setRenderTarget(this.bloomE2);
      this.renderer.render(this.scene, camera);
      cine = 1;
    }

    // composite to screen
    const cu = this.compMat.uniforms;
    cu.uScene.value = this.sceneRT.texture;
    cu.uBloomA.value = this.bloomA.texture; // final blur result lives in bloomA
    cu.uBloomE.value = this.bloomE2.texture;
    cu.uCine.value = cine;
    cu.uTime.value = time;
    this.quad.material = this.compMat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, camera);
  }

  dispose() {
    for (const rt of [this.sceneRT, this.bloomA, this.bloomB, this.bloomE, this.bloomE2]) {
      if (rt) rt.dispose();
    }
    this.sceneMat.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.renderer.dispose();
  }
}
