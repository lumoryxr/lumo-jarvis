import * as THREE from 'three';
import type { Mood } from '../core/types';

/**
 * A stripped-down HoloCore for the companion widget.
 *
 * The full `HoloCore` (used in the main stage) carries:
 *   - 5200 particle halo
 *   - 3 dashed HUD rings
 *   - EffectComposer + UnrealBloom post-pass
 *   - 48-subdivision icosahedron
 *
 * In the 280×420 widget that workload is overkill and the post-process cost
 * alone melts a MacBook trackpad. So this version:
 *   - drops the particle halo (the small widget doesn't need volumetric depth)
 *   - keeps one ring (the "is she alive?" indicator)
 *   - keeps the core noise-displaced icosahedron but at 24 subdivisions
 *   - drops post-processing — additive blending with a dark backdrop is
 *     enough at this scale
 *   - exposes the same `setState / setAmplitude / setMood` surface, so the
 *     widget's `AvatarStage` look-alike code is unchanged
 *
 * If the user ever has a beefy GPU and 280×420 starts to feel cheap we can
 * load the real HoloCore here with a flag — but for the prototype this is
 * the right trade.
 */

const STATE_LOOK: Record<string, { color: string; hot: string; turb: number; spin: number }> = {
  offline:   { color: '#22323f', hot: '#3a4d5c', turb: 0.20, spin: 0.02 },
  idle:      { color: '#0d6f86', hot: '#35e8ff', turb: 0.55, spin: 0.06 },
  listening: { color: '#1493ad', hot: '#7ef2ff', turb: 0.85, spin: 0.10 },
  thinking:  { color: '#5b3fb0', hot: '#9d7bff', turb: 1.30, spin: 0.22 },
  speaking:  { color: '#149ec2', hot: '#7ef2ff', turb: 1.10, spin: 0.13 },
  acting:    { color: '#b06a12', hot: '#ffb347', turb: 1.15, spin: 0.18 },
  error:     { color: '#a3123f', hot: '#ff4d8d', turb: 1.55, spin: 0.30 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface MoodTarget {
  hueShift: number;
  turbAdd: number;
  spinAdd: number;
  saturation: number;
  brightnessAdd: number;
}

export class MiniHoloCore {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private core!: THREE.Mesh;
  private wire!: THREE.LineSegments;
  private ring!: THREE.Line;

  private coreUniforms: Record<string, THREE.IUniform>;

  private target = { ...STATE_LOOK.idle };
  private look = { ...STATE_LOOK.idle };
  private colorTo = new THREE.Color(STATE_LOOK.idle.color);
  private colorHotTo = new THREE.Color(STATE_LOOK.idle.hot);
  private colorNow = new THREE.Color(STATE_LOOK.idle.color);
  private colorHotNow = new THREE.Color(STATE_LOOK.idle.hot);

  private moodTarget: MoodTarget = { hueShift: 0, turbAdd: 0, spinAdd: 0, saturation: 1, brightnessAdd: 0 };
  private moodNow:    MoodTarget = { hueShift: 0, turbAdd: 0, spinAdd: 0, saturation: 1, brightnessAdd: 0 };

  private amp = 0;
  private ampTarget = 0;
  /** Seconds to next blink — re-rolled each blink. */
  private blinkAt = 0.15;
  /** Currently mid-blink (lens closed) — used for the eyelid effect on the ring. */
  private blinking = false;
  /** Seconds remaining in the blink. */
  private blinkFor = 0;
  private elapsed = 0;
  private raf = 0;
  private disposed = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.2);

    this.coreUniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uTurbulence: { value: 0.5 },
      uScale: { value: 1 },
      uColor: { value: this.colorNow },
      uColorHot: { value: this.colorHotNow },
      uOpacity: { value: 1 },
    };

    this.buildCore();
    this.ring = this.buildRing();
    this.scene.add(this.ring);

    this.resize();
    this.loop();
  }

  private buildCore() {
    const geo = new THREE.IcosahedronGeometry(1, 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.coreUniforms,
      vertexShader: miniCoreVertex,
      fragmentShader: miniCoreFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    this.core = new THREE.Mesh(geo, mat);
    this.scene.add(this.core);

    const wireGeo = new THREE.IcosahedronGeometry(1, 4);
    const wireMat = new THREE.ShaderMaterial({
      uniforms: { ...this.coreUniforms, uScale: { value: 1.05 }, uOpacity: { value: 0.45 } },
      vertexShader: miniCoreVertex,
      fragmentShader: miniCoreFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.wire = new THREE.LineSegments(new THREE.WireframeGeometry(wireGeo), wireMat);
    this.scene.add(this.wire);
  }

  private buildRing(): THREE.Line {
    const pts: THREE.Vector3[] = [];
    const segments = 256;
    const radius = 1.7;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({
      color: 0x35e8ff,
      transparent: true,
      opacity: 0.32,
      dashSize: 0.06,
      gapSize: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    return line;
  }

  /* --------------------------------------------------------------- api */

  setState(state: keyof typeof STATE_LOOK) {
    const look = STATE_LOOK[state] ?? STATE_LOOK.idle;
    this.target = { ...look };
    this.colorTo.set(look.color);
    this.colorHotTo.set(look.hot);
  }

  setAmplitude(a: number) {
    this.ampTarget = clamp(a, 0, 1);
  }

  setMood(m: Mood) {
    const valence = clamp(m.valence, -1, 1);
    const arousal = clamp(m.arousal, -1, 1);
    const dominance = clamp(m.dominance, -1, 1);
    const intimacy = clamp(m.intimacy, 0, 1);
    this.moodTarget = {
      hueShift: valence * 0.06,
      turbAdd: arousal * 0.15,
      spinAdd: arousal * 0.06,
      saturation: 1 + dominance * 0.18,
      brightnessAdd: (intimacy - 0.3) * 0.12,
    };
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const any = o as THREE.Mesh;
      any.geometry?.dispose?.();
      const m = any.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------- loop */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    const t = this.elapsed;

    const k = 1 - Math.pow(0.0015, dt);
    this.amp += (this.ampTarget - this.amp) * k;
    this.look.turb += (this.target.turb - this.look.turb) * k;
    this.look.spin += (this.target.spin - this.look.spin) * k;

    const mk = 1 - Math.pow(0.0008, dt);
    this.moodNow.hueShift      += (this.moodTarget.hueShift      - this.moodNow.hueShift)      * mk;
    this.moodNow.turbAdd       += (this.moodTarget.turbAdd       - this.moodNow.turbAdd)       * mk;
    this.moodNow.spinAdd       += (this.moodTarget.spinAdd       - this.moodNow.spinAdd)       * mk;
    this.moodNow.saturation    += (this.moodTarget.saturation    - this.moodNow.saturation)    * mk;
    this.moodNow.brightnessAdd += (this.moodTarget.brightnessAdd - this.moodNow.brightnessAdd) * mk;

    /* Blink scheduling — humans blink every 2-6s; an avatar without blinks
     * reads as "dead". Closed-eye phase is ~110ms. We schedule the next
     * one after the current one finishes. */
    if (this.blinking) {
      this.blinkFor -= dt;
      if (this.blinkFor <= 0) {
        this.blinking = false;
        this.blinkAt = t + 2 + Math.random() * 4;
      }
    } else if (t >= this.blinkAt) {
      this.blinking = true;
      this.blinkFor = 0.11;
    }
    const blinkScale = this.blinking ? 0.04 : 1; // squash Y → eyelid

    const hsl = { h: 0, s: 0, l: 0 };
    const hslH = { h: 0, s: 0, l: 0 };
    this.colorTo.getHSL(hsl);
    this.colorHotTo.getHSL(hslH);
    hsl.h = (hsl.h + this.moodNow.hueShift + 1) % 1;
    hslH.h = (hslH.h + this.moodNow.hueShift + 1) % 1;
    hsl.s = clamp(hsl.s * this.moodNow.saturation, 0, 1);
    hsl.l = clamp(hsl.l + this.moodNow.brightnessAdd, 0, 1);
    hslH.s = clamp(hslH.s * this.moodNow.saturation, 0, 1);
    hslH.l = clamp(hslH.l + this.moodNow.brightnessAdd * 1.4, 0, 1);
    this.colorTo.setHSL(hsl.h, hsl.s, hsl.l);
    this.colorHotTo.setHSL(hslH.h, hslH.s, hslH.l);

    this.colorNow.lerp(this.colorTo, k);
    this.colorHotNow.lerp(this.colorHotTo, k);

    this.coreUniforms.uTime.value = t;
    this.coreUniforms.uAmp.value = this.amp;
    this.coreUniforms.uTurbulence.value = this.look.turb + this.moodNow.turbAdd;

    this.core.rotation.y += (this.look.spin + this.moodNow.spinAdd) * dt;
    this.core.rotation.x = Math.sin(t * 0.14) * 0.12;
    this.core.scale.set(1, blinkScale, 1);
    this.wire.rotation.copy(this.core.rotation);
    this.wire.scale.set(1, blinkScale, 1);

    // Idle float — bobs gently to feel "alive" even when nothing's happening.
    const floatY = Math.sin(t * 0.6) * 0.05;
    this.core.position.y = floatY;
    this.wire.position.y = floatY;

    this.ring.rotation.z += (this.look.spin + this.moodNow.spinAdd) * 0.5 * dt;

    this.renderer.render(this.scene, this.camera);
  };
}

/* -------------------------------------------------------- shaders */

/**
 * Stripped versions of HoloCore's shaders: no Fresnel-only alpha hack, no
 * halo contribution, simpler lighting — the widget sits on a darker frame
 * so the core can rely on a thicker additive contribution.
 *
 * Vertex copy is intentionally identical to the big version; the savings come
 * from the simpler fragment.
 */
const miniCoreVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uTurbulence;
  uniform float uScale;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDisplace;

  // 3D simplex noise — Ian McEwan, Ashima Arts (MIT)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-viewPos.xyz);

    float n = snoise(position * 1.4 + uTime * 0.18);
    float amp = uAmp * 0.18 + uTurbulence * 0.08;
    float disp = n * (0.06 + amp) * uScale;
    vDisplace = disp;

    vec3 displaced = position + normal * disp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced * uScale, 1.0);
  }
`;

const miniCoreFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColorHot;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDisplace;

  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.2);
    float hot = clamp(vDisplace * 4.0, 0.0, 1.0);
    vec3 col = mix(uColor, uColorHot, hot * 0.8 + fres * 0.4);
    float alpha = (0.04 + fres * 0.95) * uOpacity;
    gl_FragColor = vec4(col, alpha);
  }
`;