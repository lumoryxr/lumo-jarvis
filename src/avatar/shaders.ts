/**
 * GLSL for the holographic core.
 *
 * The avatar is a signal, not a mesh of a person: a displaced isosurface whose
 * turbulence tracks what the agent is doing, wrapped in a fresnel rim so it
 * reads as volumetric light rather than plastic. Simplex noise below is the
 * standard Ashima/Gustavson implementation (MIT).
 */

const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

export const coreVertex = /* glsl */ `
${SIMPLEX}

uniform float uTime;
uniform float uAmp;        // 0..1, speech / activity amplitude
uniform float uTurbulence; // per-state noise gain
uniform float uScale;

varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;

void main() {
  // Two octaves: a slow swell plus a fast shimmer that only shows up when the
  // agent is actually saying or doing something.
  float slow = snoise(normal * 1.15 + uTime * 0.18);
  float fast = snoise(normal * 3.40 - uTime * 0.75);
  float n = slow * 0.72 + fast * 0.28 * (0.35 + uAmp);

  vNoise = n;

  float displacement = n * uTurbulence * (0.14 + uAmp * 0.42);
  vec3 pos = position * uScale * (1.0 + displacement);

  vec4 world = modelViewMatrix * vec4(pos, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-world.xyz);

  gl_Position = projectionMatrix * world;
}
`;

export const coreFragment = /* glsl */ `
uniform vec3  uColor;
uniform vec3  uColorHot;
uniform float uOpacity;

varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;

void main() {
  // Fresnel: near-transparent facing the camera, incandescent at grazing
  // angles. The exponent is high so the interior stays dark — with additive
  // blending a flat interior blows out to white the moment bloom touches it.
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 3.2);

  vec3 col = mix(uColor, uColorHot, smoothstep(-0.2, 0.8, vNoise));
  col *= 0.34 + fres * 1.85;

  float alpha = (0.02 + fres * 0.88) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

export const haloVertex = /* glsl */ `
${SIMPLEX}

uniform float uTime;
uniform float uAmp;
uniform float uRadius;
uniform float uPixelRatio;

attribute float aSeed;

varying float vAlpha;

void main() {
  vec3 dir = normalize(position);

  // Each particle breathes on its own phase so the shell never pulses as a
  // single rigid blob.
  float drift = snoise(dir * 1.8 + uTime * 0.22 + aSeed);
  float radius = uRadius * (1.0 + drift * 0.09 + uAmp * 0.16);

  vec3 pos = dir * radius;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);

  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.7 + aSeed * 1.5 + uAmp * 1.8) * uPixelRatio * (9.0 / -mv.z);

  vAlpha = 0.05 + 0.26 * smoothstep(-0.4, 0.9, drift) + uAmp * 0.16;
}
`;

export const haloFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  // Round, soft-edged points; discard the corners of the quad.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float falloff = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(uColor, vAlpha * falloff);
}
`;

/**
 * Camera-facing radial glow sitting behind the shell. Without it the core reads
 * as a dim globe; with it there is something burning inside the lattice. Kept
 * as a separate billboard rather than raising the shell's alpha, because the
 * shell's alpha is flat across the disc and blows out to white under bloom.
 */
export const glowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const glowFragment = /* glsl */ `
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;

varying vec2 vUv;

void main() {
  float d = length(vUv - 0.5) * 2.0;

  // Two lobes: a tight hot centre and a wide halo, so the falloff never shows
  // a hard edge against the background.
  float centre = pow(max(0.0, 1.0 - d), 6.0);
  float halo   = pow(max(0.0, 1.0 - d), 2.0) * 0.42;

  // Slow breathing keeps it alive while idle.
  float breathe = 0.9 + 0.1 * sin(uTime * 0.9);

  gl_FragColor = vec4(uColor, (centre + halo) * uIntensity * breathe);
}
`;
