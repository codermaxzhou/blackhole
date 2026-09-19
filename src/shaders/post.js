// Post-processing shader chain: bright pass -> separable gaussian blur
// (quarter + optional eighth, cinematic) -> composite (chromatic
// aberration, HDR bloom, ACES tonemapping, vignette, film grain, dither).

export const POST_VERTEX = `precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BRIGHT_PASS_FRAGMENT = `precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThresh;
void main() {
  vec4 t = texture(uTex, vUv);
  float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThresh, uThresh + 0.6, l);
  fragColor = vec4(t.rgb * w, 1.0);
}
`;

export const BLUR_FRAGMENT = `precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDir;      // texel units * direction
uniform vec2 uTexel;
void main() {
  vec2 px = uDir * uTexel;
  vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
  vec2 o1 = px * 1.3846153846;
  vec2 o2 = px * 3.2307692308;
  s += (texture(uTex, vUv + o1).rgb + texture(uTex, vUv - o1).rgb) * 0.3162162162;
  s += (texture(uTex, vUv + o2).rgb + texture(uTex, vUv - o2).rgb) * 0.0702702703;
  fragColor = vec4(s, 1.0);
}
`;

export const COMPOSITE_FRAGMENT = `precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomE;
uniform float uBloomStr;
uniform float uVignette;
uniform float uGrain;
uniform float uExposure;
uniform float uTime;
uniform float uCine;
uniform vec2  uRes;

float h13(vec3 p) {
  p = fract(p * 0.1031 + 0.53);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d)) + e, 0.0, 1.0);
}

void main() {
  vec2 cxy = vUv - 0.5;
  float r2 = dot(cxy, cxy);
  float aspect = uRes.x / max(uRes.y, 1.0);

  // subtle chromatic aberration (radial)
  vec2 off = cxy * 0.0026 * (0.55 + 2.4 * r2);
  vec3 col;
  col.r = texture(uScene, vUv - off).r;
  col.g = texture(uScene, vUv).g;
  col.b = texture(uScene, vUv + off).b;

  col *= uExposure;

  vec3 bloom = texture(uBloomA, vUv).rgb;
  if (uCine > 0.5) {
    bloom += texture(uBloomE, vUv).rgb * 0.9;
  }
  col += bloom * uBloomStr;

  col = aces(col);

  // vignette
  float vlen = length(cxy * vec2(aspect, 1.0));
  float vig = 1.0 - uVignette * smoothstep(0.40, 0.98, vlen);
  col *= vig;

  // film grain (luminance-scaled, temporal)
  float gn = h13(vec3(gl_FragCoord.xy, fract(uTime) * 131.0)) - 0.5;
  col += gn * uGrain * (0.35 + 0.65 * dot(col, vec3(0.3333)));

  // banding-kill dither
  col += (h13(vec3(gl_FragCoord.xy, 7.7)) - 0.5) * (1.6 / 255.0);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
