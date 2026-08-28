import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { coreVertex, coreFragment, haloVertex, haloFragment, glowVertex, glowFragment } from './shaders';
import type { AgentState } from '../core/types';

/**
 * The digital human.
 *
 * Rather than a rigged head — which needs a licensed model, a blendshape rig
 * and a viseme pipeline before it looks like anything — the default avatar is a
 * volumetric core: a noise-displaced isosurface inside a particle shell inside
 * three HUD rings. It reads as *present* and it reacts to speech amplitude, so
 * the conversation feels addressed to someone.
 *
 * A rigged avatar is a drop-in replacement: implement the same
 * `setState` / `setAmplitude` surface over a VRM or GLB and mount it in
 * `AvatarStage` instead. See docs/DESIGN.md § 数字人.
 */

/** Per-state look. Colours are read from CSS tokens so themes stay in one place. */
const STATE_LOOK: Record<AgentState, { color: string; hot: string; turbulence: number; spin: number; ringSpin: number }> = {
  offline:   { color: '#22323f', hot: '#3a4d5c', turbulence: 0.25, spin: 0.02, ringSpin: 0.05 },
  idle:      { color: '#0d6f86', hot: '#35e8ff', turbulence: 0.55, spin: 0.06, ringSpin: 0.18 },
  listening: { color: '#1493ad', hot: '#7ef2ff', turbulence: 0.85, spin: 0.10, ringSpin: 0.42 },
  thinking:  { color: '#5b3fb0', hot: '#9d7bff', turbulence: 1.30, spin: 0.22, ringSpin: 0.78 },
  speaking:  { color: '#149ec2', hot: '#7ef2ff', turbulence: 1.10, spin: 0.13, ringSpin: 0.34 },
  acting:    { color: '#b06a12', hot: '#ffb347', turbulence: 1.15, spin: 0.18, ringSpin: 0.60 },
  error:     { color: '#a3123f', hot: '#ff4d8d', turbulence: 1.55, spin: 0.30, ringSpin: 0.95 },
};

const HALO_COUNT = 5200;

export class HoloCore {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private clock = new THREE.Clock();

  private core!: THREE.Mesh;
  private wire!: THREE.LineSegments;
  private halo!: THREE.Points;
  private glow!: THREE.Mesh;
  private rings: THREE.Group;

  private coreUniforms: Record<string, THREE.IUniform>;
  private haloUniforms: Record<string, THREE.IUniform>;
  private glowUniforms: Record<string, THREE.IUniform>;

  /** Smoothed toward the target so state changes cross-fade instead of snapping. */
  private look = { ...STATE_LOOK.offline };
  private target = { ...STATE_LOOK.offline };
  private colorNow = new THREE.Color(STATE_LOOK.offline.color);
  private colorHotNow = new THREE.Color(STATE_LOOK.offline.hot);
  private colorTo = new THREE.Color(STATE_LOOK.offline.color);
  private colorHotTo = new THREE.Color(STATE_LOOK.offline.hot);

  private amp = 0;
  private ampTarget = 0;
  private raf = 0;
  private disposed = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.6);

    this.coreUniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uTurbulence: { value: 0.5 },
      uScale: { value: 1 },
      uColor: { value: this.colorNow },
      uColorHot: { value: this.colorHotNow },
      uOpacity: { value: 1 },
    };

    this.haloUniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uRadius: { value: 1.88 },
      uPixelRatio: { value: dpr },
      uColor: { value: this.colorHotNow },
    };

    this.glowUniforms = {
      uColor: { value: this.colorHotNow },
      uIntensity: { value: 0.55 },
      uTime: { value: 0 },
    };

    this.buildGlow();
    this.buildCore();
    this.buildHalo();
    this.rings = this.buildRings();
    this.scene.add(this.rings);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.82, 0.30);
    this.composer.addPass(this.bloom);

    this.resize();
    this.loop();
  }

  /* ------------------------------------------------------------ geometry */

  /** Camera-facing radial glow behind the shell. */
  private buildGlow() {
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.ShaderMaterial({
        uniforms: this.glowUniforms,
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    // Behind everything; the camera never moves, so a fixed facing plane is
    // enough and avoids a per-frame quaternion copy.
    this.glow.position.z = -0.4;
    this.glow.renderOrder = -1;
    this.scene.add(this.glow);
  }

  private buildCore() {
    const geo = new THREE.IcosahedronGeometry(1, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.coreUniforms,
      vertexShader: coreVertex,
      fragmentShader: coreFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    this.core = new THREE.Mesh(geo, mat);
    this.scene.add(this.core);

    // A coarse wireframe over the same displacement field reads as structure
    // inside the glow, and costs almost nothing.
    const wireGeo = new THREE.IcosahedronGeometry(1, 4);
    const wireMat = new THREE.ShaderMaterial({
      uniforms: { ...this.coreUniforms, uScale: { value: 1.05 }, uOpacity: { value: 0.5 } },
      vertexShader: coreVertex,
      fragmentShader: coreFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.wire = new THREE.LineSegments(new THREE.WireframeGeometry(wireGeo), wireMat);
    this.scene.add(this.wire);
  }

  private buildHalo() {
    const positions = new Float32Array(HALO_COUNT * 3);
    const seeds = new Float32Array(HALO_COUNT);

    // Fibonacci sphere — even coverage, no polar clumping.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < HALO_COUNT; i++) {
      const y = 1 - (i / (HALO_COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.halo = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.haloUniforms,
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(this.halo);
  }

  /** Three dashed gyroscope rings on independent tilts. */
  private buildRings(): THREE.Group {
    const group = new THREE.Group();
    const specs = [
      { radius: 2.05, tilt: [1.32, 0.0, 0.22], dash: 0.06, opacity: 0.55 },
      { radius: 2.42, tilt: [0.42, 0.9, 0.0], dash: 0.14, opacity: 0.32 },
      { radius: 2.78, tilt: [1.05, -0.6, 0.5], dash: 0.03, opacity: 0.22 },
    ];

    for (const spec of specs) {
      const pts: THREE.Vector3[] = [];
      const segments = 512;
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * spec.radius, 0, Math.sin(a) * spec.radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({
        color: 0x35e8ff,
        transparent: true,
        opacity: spec.opacity,
        dashSize: spec.dash,
        gapSize: spec.dash * 2.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      line.rotation.set(spec.tilt[0], spec.tilt[1], spec.tilt[2]);
      group.add(line);
    }
    return group;
  }

  /* --------------------------------------------------------------- api */

  setState(state: AgentState) {
    const look = STATE_LOOK[state] ?? STATE_LOOK.idle;
    this.target = { ...look };
    this.colorTo.set(look.color);
    this.colorHotTo.set(look.hot);
  }

  /** 0..1 speech/activity envelope. */
  setAmplitude(a: number) {
    this.ampTarget = Math.min(1, Math.max(0, a));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
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
    this.composer.dispose();
    this.renderer.dispose();
  }

  /* -------------------------------------------------------------- loop */

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // Critically-damped-ish approach: fast enough to feel responsive, slow
    // enough that a burst of tool calls does not strobe.
    const k = 1 - Math.pow(0.0015, dt);
    this.amp += (this.ampTarget - this.amp) * k;
    this.look.turbulence += (this.target.turbulence - this.look.turbulence) * k;
    this.look.spin += (this.target.spin - this.look.spin) * k;
    this.look.ringSpin += (this.target.ringSpin - this.look.ringSpin) * k;
    this.colorNow.lerp(this.colorTo, k);
    this.colorHotNow.lerp(this.colorHotTo, k);

    this.coreUniforms.uTime.value = t;
    this.coreUniforms.uAmp.value = this.amp;
    this.coreUniforms.uTurbulence.value = this.look.turbulence;
    this.haloUniforms.uTime.value = t;
    this.haloUniforms.uAmp.value = this.amp;
    this.glowUniforms.uTime.value = t;
    this.glowUniforms.uIntensity.value = 0.42 + this.amp * 0.5 + this.look.turbulence * 0.14;

    this.core.rotation.y += this.look.spin * dt;
    this.core.rotation.x = Math.sin(t * 0.14) * 0.12;
    this.wire.rotation.copy(this.core.rotation);
    this.halo.rotation.y -= this.look.spin * 0.4 * dt;

    const rings = this.rings.children;
    rings[0].rotation.z += this.look.ringSpin * dt;
    rings[1].rotation.y += this.look.ringSpin * 0.62 * dt;
    rings[2].rotation.x -= this.look.ringSpin * 0.38 * dt;

    this.bloom.strength = 0.50 + this.amp * 0.5;

    this.composer.render();
  };
}
