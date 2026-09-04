/**
 * VRMAvatar — Three.js scene that renders either:
 *   (a) a real VRM model loaded from a URL / .vrm file blob, or
 *   (b) a procedurally-built humanoid (head + shoulders + blinking
 *       eyes + lip-sync mouth) as the fallback when no model is loaded.
 *
 * The procedural path is the default. The user can drop a .vrm into
 * a /models folder or paste a URL in the settings; the loader
 * dynamically imports @pixiv/three-vrm at runtime so the dev bundle
 * doesn't grow unless the user actually opts in.
 *
 * Public surface mirrors HoloCore so the existing AvatarStage
 * component can drop in either one based on `modelLoaded`.
 */

import * as THREE from 'three';
import type { Viseme, VisemeFrame } from '../services/visemes';

/* ----------------------------------------------------------------- types */

export type AvatarMode = 'procedural' | 'vrm';

export interface VRMAvatarOptions {
  width: number;
  height: number;
  background?: number;   // 0xRRGGBB
}

/* ---------------------------------------------------- procedural fallback */

class ProceduralAvatar {
  readonly root: THREE.Group;
  private head: THREE.Mesh;
  private jaw: THREE.Mesh;
  private leftEye: THREE.Mesh;
  private rightEye: THREE.Mesh;
  private leftPupil: THREE.Mesh;
  private rightPupil: THREE.Mesh;
  private glow: THREE.Mesh;
  private eyebrowL: THREE.Mesh;
  private eyebrowR: THREE.Mesh;
  private neck: THREE.Mesh;
  private shoulderL: THREE.Mesh;
  private shoulderR: THREE.Mesh;
  private breathPhase = 0;
  private blinkPhase = 0;
  private nextBlink = 2.5 + Math.random() * 2.5;

  constructor() {
    this.root = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({
      color: 0x2a3548, metalness: 0.15, roughness: 0.55,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x35e8ff, emissive: 0x0d6f86, metalness: 0.1, roughness: 0.4,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x7ef2ff, emissiveIntensity: 0.4,
    });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0c1622 });
    const hair = new THREE.MeshStandardMaterial({
      color: 0x151a25, metalness: 0.5, roughness: 0.3,
    });

    // Head
    this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skin);
    this.head.scale.set(1, 1.1, 0.95);
    this.head.position.y = 0.6;
    this.root.add(this.head);

    // Hair cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.02, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.y = 0.62;
    this.root.add(cap);

    // Hair tail (long hair behind)
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.3, 1.4, 16), hair);
    tail.position.set(0, -0.2, -0.5);
    this.root.add(tail);

    // Neck
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.3, 16), skin);
    this.neck.position.y = -0.5;
    this.root.add(this.neck);

    // Shoulders / chest
    this.shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), skin);
    this.shoulderL.position.set(-0.55, -0.85, 0);
    this.shoulderL.scale.set(1, 0.7, 1);
    this.root.add(this.shoulderL);
    this.shoulderR = this.shoulderL.clone();
    this.shoulderR.position.x = 0.55;
    this.root.add(this.shoulderR);

    // Eyes
    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), eyeMat);
    this.leftEye.position.set(-0.35, 0.7, 0.85);
    this.leftEye.scale.set(1, 1.2, 0.5);
    this.root.add(this.leftEye);
    this.rightEye = this.leftEye.clone();
    this.rightEye.position.x = 0.35;
    this.root.add(this.rightEye);

    this.leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), pupilMat);
    this.leftPupil.position.set(-0.35, 0.7, 0.97);
    this.root.add(this.leftPupil);
    this.rightPupil = this.leftPupil.clone();
    this.rightPupil.position.x = 0.35;
    this.root.add(this.rightPupil);

    // Mouth (jaw) — pivot at the top so the bottom swings open.
    const jawGeom = new THREE.SphereGeometry(0.18, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    this.jaw = new THREE.Mesh(jawGeom, new THREE.MeshStandardMaterial({ color: 0x1a0e16, roughness: 0.6 }));
    this.jaw.scale.set(1, 0.6, 0.6);
    this.jaw.position.set(0, 0.18, 0.85);
    this.root.add(this.jaw);

    // Cyan accent ring at the collar
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.025, 16, 64),
      accent,
    );
    ring.position.y = -0.78;
    ring.rotation.x = Math.PI / 2;
    this.root.add(ring);

    // Soft glow disc behind the head
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 64),
      new THREE.MeshBasicMaterial({
        color: 0x35e8ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
      }),
    );
    this.glow.position.z = -0.6;
    this.root.add(this.glow);

    // M7-F: eyebrows. Two thin arcs above the eyes that rotate
    // around their midpoint when setEmotion is called.
    const eyebrowGeom = new THREE.TorusGeometry(0.18, 0.02, 8, 24, Math.PI);
    const eyebrowMat = new THREE.MeshStandardMaterial({
      color: 0x151a25, metalness: 0.4, roughness: 0.4,
    });
    this.eyebrowL = new THREE.Mesh(eyebrowGeom, eyebrowMat);
    this.eyebrowL.position.set(-0.35, 0.95, 0.85);
    this.eyebrowL.rotation.z = Math.PI;
    this.root.add(this.eyebrowL);
    this.eyebrowR = new THREE.Mesh(eyebrowGeom, eyebrowMat);
    this.eyebrowR.position.set(0.35, 0.95, 0.85);
    this.eyebrowR.rotation.z = 0;
    this.root.add(this.eyebrowR);

    this.root.position.set(0, -0.3, 0);
  }

  setMouth(viseme: Viseme, openness: number) {
    // Map viseme to jaw rotation. The opening rotates the lower half
    // around the X axis (pivot at the top of the jaw sphere).
    const map: Record<Viseme, number> = {
      sil: 0, aa: 0.45, E: 0.32, I: 0.22, O: 0.36, U: 0.28,
      bmp: 0.04, fv: 0.16, l: 0.18, wq: 0.18, etc: 0.10,
    };
    const open = (map[viseme] ?? 0) * Math.max(0.1, Math.min(1, openness));
    this.jaw.rotation.x = open;
  }

  setGaze(target: { x: number; y: number } | null) {
    // Move pupils within the eye. Soft clamp at radius 0.04.
    const range = 0.04;
    const tx = target ? Math.max(-range, Math.min(range, target.x * 0.06)) : 0;
    const ty = target ? Math.max(-range, Math.min(range, target.y * 0.06 - 0.01)) : 0;
    // Slight head lean in the gaze direction.
    const headTilt = target ? Math.max(-0.08, Math.min(0.08, target.x * 0.05)) : 0;
    const headNod = target ? Math.max(-0.06, Math.min(0.06, -target.y * 0.04)) : 0;
    this.leftPupil.position.x = -0.35 + tx;
    this.rightPupil.position.x = 0.35 + tx;
    this.leftPupil.position.y = 0.7 + ty;
    this.rightPupil.position.y = 0.7 + ty;
    this.head.rotation.y = headTilt;
    this.head.rotation.x = headNod;
  }

  /** Mood shift — recolours the head and tone via emissive. */
  setMoodHex(hex: number) {
    const c = new THREE.Color(hex);
    const mat = this.head.material as THREE.MeshStandardMaterial;
    mat.emissive = c;
    mat.emissiveIntensity = 0.18;
  }

  /**
   * M7-F: emotion-driven micro-expression. Drives the eyebrow tilt
   * (above the eyes) based on the persona's current emotion. The
   * eyebrows are two thin arcs that lean inward for concerned /
   * sad, outward for happy / playful, up for surprised.
   */
  setEmotion(emotion: string, intensity: number) {
    const clamped = Math.max(0, Math.min(1, intensity));
    // Map emotion -> (left tilt, right tilt). Both default to 0.
    const map: Record<string, [number, number]> = {
      neutral:    [0, 0],
      happy:      [0.08, -0.08],
      sad:        [-0.08, -0.08],
      angry:      [-0.18, 0.18],
      surprised:  [0.18, 0.18],
      disgusted:  [-0.10, 0.10],
      fearful:    [0.12, 0.12],
      tender:     [0.04, -0.04],
      playful:    [0.10, 0.10],
      curious:    [0.06, 0.06],
      concerned:  [-0.12, -0.12],
    };
    const [l, r] = map[emotion] ?? [0, 0];
    if (this.eyebrowL) this.eyebrowL.rotation.z = l * clamped;
    if (this.eyebrowR) this.eyebrowR.rotation.z = r * clamped;
  }

  setAmplitude(amp: number) {
    // Push the mouth open by amp * viseme-drive. Caller has already
    // applied the viseme shape; this is a peak boost.
    this.jaw.rotation.x = Math.min(0.6, this.jaw.rotation.x + amp * 0.18);
  }

  tick(_t: number, dt: number) {
    this.breathPhase += dt * 0.6;
    const breath = Math.sin(this.breathPhase) * 0.04;
    this.head.position.y = 0.6 + breath * 0.6;
    this.neck.position.y = -0.5 + breath * 0.5;

    // Blink
    this.blinkPhase += dt;
    if (this.blinkPhase > this.nextBlink) {
      this.leftEye.scale.y = 0.05;
      this.rightEye.scale.y = 0.05;
      if (this.blinkPhase > this.nextBlink + 0.15) {
        this.leftEye.scale.y = 1.2;
        this.rightEye.scale.y = 1.2;
        this.blinkPhase = 0;
        this.nextBlink = 2.5 + Math.random() * 2.5;
      }
    }
  }
}

/* ---------------------------------------------------------------- VRM hook */

type VRMHandle = { vrm: unknown; scene: THREE.Object3D };
async function tryLoadVrm(url: string): Promise<VRMHandle | null> {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { VRMLoaderPlugin } = await import('@pixiv/three-vrm');
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = (gltf as { userData: { vrm?: unknown } }).userData.vrm;
    if (!vrm) return null;
    return { vrm, scene: gltf.scene };
  } catch (e) {
    console.warn('[vrm] load failed:', e);
    return null;
  }
}

/* ----------------------------------------------------------------- main class */

export class VRMAvatar {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private procedural: ProceduralAvatar;
  private vrmHandle: VRMHandle | null = null;
  private mode: AvatarMode = 'procedural';
  private amplitude = 0;
  private gaze: { x: number; y: number } | null = null;
  private visemeFrames: VisemeFrame[] = [];
  private visemeCursorMs = 0;
  private currentViseme: Viseme = 'sil';
  private raf = 0;
  private lastT = performance.now();
  private pendingModel: string | null = null;
  private mounted = false;
  private mount: HTMLElement | null = null;
  private resizeObs: ResizeObserver | null = null;
  private ampSmoothed = 0;

  // M2 options. Stored explicitly so the public surface doesn't need
  // a `private` shorthand (which erasable-syntax-only mode disallows).
  private readonly opts: VRMAvatarOptions;
  constructor(opts: VRMAvatarOptions) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(opts.width, opts.height, false);
    this.renderer.setClearColor(opts.background ?? 0x060c16, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, opts.width / opts.height, 0.1, 100);
    this.camera.position.set(0, 0.1, 5.6);

    // Lighting: key + rim + soft fill.
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x35e8ff, 0.7);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);
    const fill = new THREE.AmbientLight(0x7c93a8, 0.35);
    this.scene.add(fill);

    this.procedural = new ProceduralAvatar();
    this.scene.add(this.procedural.root);
  }

  attach(el: HTMLElement) {
    this.mount = el;
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('vrm-avatar-canvas');
    this.mounted = true;
    if (this.pendingModel) {
      this.loadModel(this.pendingModel);
      this.pendingModel = null;
    }
    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(el);
    this.handleResize();
    this.start();
  }

  detach() {
    this.mounted = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    this.renderer.domElement.remove();
  }

  dispose() {
    this.detach();
    this.renderer.dispose();
  }

  /** Real VRM model URL. Loaded async; if it fails, we stay on the
   *  procedural fallback. */
  async loadModel(url: string) {
    if (!this.mounted) {
      this.pendingModel = url;
      return;
    }
    const handle = await tryLoadVrm(url);
    if (!handle) {
      console.warn('[vrm] using procedural fallback');
      return;
    }
    // Remove the procedural avatar, add the VRM scene.
    this.scene.remove(this.procedural.root);
    this.scene.add(handle.scene);
    if (this.vrmHandle) this.scene.remove(this.vrmHandle.scene);
    this.vrmHandle = handle;
    this.mode = 'vrm';
  }

  /** Drop the loaded model and fall back to the procedural avatar. */
  unloadModel() {
    if (this.vrmHandle) {
      this.scene.remove(this.vrmHandle.scene);
      this.vrmHandle = null;
    }
    if (!this.scene.children.includes(this.procedural.root)) {
      this.scene.add(this.procedural.root);
    }
    this.mode = 'procedural';
  }

  getMode(): AvatarMode { return this.mode; }

  /** Match HoloCore's API. */
  setAmplitude(amp: number) {
    this.amplitude = Math.max(0, Math.min(1, amp));
  }

  /** Match HoloCore's API. */
  setMoodHex(hex: number) {
    this.procedural.setMoodHex(hex);
    // M2: keep the hex around for the VRM blendshape path in M3.
    this._lastMoodHex = hex;
  }

  // M2: last-mood hex retained for future VRM blendshape tinting.
  private _lastMoodHex: number = 0x35e8ff;

  // M7-F: emotion -> eyebrow tilt on the procedural avatar. The
  // optional `?` in the JSX call sites protects the surface if we
  // ever switch back to HoloCore (which doesn't have eyebrows).
  setEmotion(emotion: string, intensity: number) {
    this.procedural.setEmotion(emotion, intensity);
  }

  /** Viseme stream from the conversation pipeline. The cursor advances
   *  inside the loop at 1ms per ms; we reset on a new stream. */
  setVisemes(frames: VisemeFrame[]) {
    this.visemeFrames = frames;
    this.visemeCursorMs = 0;
  }

  /** Update gaze (normalized 0..1 in each axis from screen center). */
  setGaze(target: { x: number; y: number } | null) {
    this.gaze = target;
  }

  private handleResize() {
    if (!this.mount) return;
    const w = this.mount.clientWidth || this.opts.width;
    const h = this.mount.clientHeight || this.opts.height;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private start() {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      this.tick(t / 1000, dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private tick(_t: number, dt: number) {
    // 1) Viseme advancement — the cursor walks forward at 1ms per ms
    //    (real time). When a frame's budget is exhausted, jump to the
    //    next one. The chosen viseme becomes the current jaw shape.
    if (this.visemeFrames.length > 0) {
      this.visemeCursorMs += dt * 1000;
      let acc = 0;
      let chosen: Viseme = 'sil';
      for (const f of this.visemeFrames) {
        if (this.visemeCursorMs < acc + f.dur) { chosen = f.v; break; }
        acc += f.dur;
        chosen = f.v;
      }
      this.currentViseme = chosen;
    } else {
      this.currentViseme = 'sil';
    }

    // 2) Smoothed amplitude (used as a peak boost on top of viseme).
    this.ampSmoothed += (this.amplitude - this.ampSmoothed) * Math.min(1, dt * 8);

    // 3) Apply to the procedural avatar; for VRM we can apply to
    //    expressionManager in M3 (when we wire the BlendShape API).
    this.procedural.tick(performance.now() / 1000, dt);
    this.procedural.setMouth(this.currentViseme, 0.6 + this.ampSmoothed * 0.4);
    this.procedural.setAmplitude(this.ampSmoothed);
    this.procedural.setGaze(this.gaze);

    if (this.mode === 'vrm' && this.vrmHandle) {
      // M2 placeholder: tilt the whole scene slightly toward gaze.
      const g = this.gaze ?? { x: 0, y: 0 };
      this.vrmHandle.scene.rotation.y = g.x * 0.2;
      this.vrmHandle.scene.rotation.x = -g.y * 0.1;
      // Subtle idle bob.
      this.vrmHandle.scene.position.y = Math.sin(performance.now() / 1500) * 0.03;
    }
    // M2: keep the mood hex in scope so a future VRM blendshape tint
    // can read it without a re-render. The procedural avatar consumes
    // it eagerly in setMoodHex above.
    void this._lastMoodHex;

    this.renderer.render(this.scene, this.camera);
  }
}
