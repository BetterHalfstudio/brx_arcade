// WebGL2 CRT post-process shaders. Each effect is gated by its own uniform so
// an amount of 0 contributes nothing (clean nearest-neighbor passthrough).

export const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // a_pos is a fullscreen quad in clip space (-1..1).
  vec2 uv = a_pos * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;   // canvas textures are top-left origin; flip to upright
  v_uv = uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2  u_texRes;     // source size (the pixel grid)
uniform vec2  u_outRes;     // output drawing-buffer size (device px)
uniform float u_time;
uniform float u_barrel;
uniform float u_scanline;
uniform float u_glow;
uniform float u_aberration;
uniform float u_vignette;
uniform float u_flicker;
uniform float u_mask;

const float PI = 3.14159265;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// minimal barrel/bulge — bows the image outward
vec2 curve(vec2 uv, float amt){
  uv = uv * 2.0 - 1.0;
  uv *= vec2(1.0 + (uv.y * uv.y) * amt, 1.0 + (uv.x * uv.x) * amt);
  return uv * 0.5 + 0.5;
}

vec3 samp(vec2 uv){
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture(u_tex, uv).rgb;
}

void main(){
  vec2 uv = curve(v_uv, u_barrel * 0.25);

  // chromatic aberration — split R/B along the radius
  vec2 dir = uv - 0.5;
  float ca = u_aberration * 0.0038;
  vec3 col;
  col.r = samp(uv + dir * ca).r;
  col.g = samp(uv).g;
  col.b = samp(uv - dir * ca).b;

  // cheap bloom — ring-sample bright neighbours
  if (u_glow > 0.001) {
    vec3 bloom = vec3(0.0);
    vec2 px = 1.0 / u_texRes;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * 6.2831853;
      vec2 o = vec2(cos(a), sin(a));
      bloom += samp(uv + o * px * 2.0) * 0.6;
      bloom += samp(uv + o * px * 4.0) * 0.4;
    }
    bloom /= 8.0;
    bloom *= smoothstep(0.32, 0.9, luma(bloom));
    col += bloom * u_glow * 1.5;
  }

  // scanlines: a screen-space overlay at a fixed line count, DECOUPLED from the
  // pixel grid so they never align with pixel rows (which would hide every other
  // row). Gentle — brightness never drops below ~0.5, so no pixel is lost.
  if (u_scanline > 0.001) {
    float yy = gl_FragCoord.y / u_outRes.y; // 0..1 in output space
    float lines = 240.0;                     // classic CRT line count
    float roll = u_time * 0.6;
    float s = 0.5 + 0.5 * sin((yy * lines - roll) * 6.2831853);
    col *= mix(1.0, 0.5 + 0.5 * s, u_scanline);
  }

  // aperture / phosphor mask on output pixels (RGB triads)
  if (u_mask > 0.001) {
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mask = vec3(0.5);
    if (m < 1.0) mask.r = 1.0; else if (m < 2.0) mask.g = 1.0; else mask.b = 1.0;
    col *= mix(vec3(1.0), mask, u_mask * 0.6);
    col *= 1.0 + u_mask * 0.28; // compensate the average darkening
  }

  // flicker + fine noise
  if (u_flicker > 0.001) {
    float fl = 1.0 - u_flicker * 0.06 * (0.5 + 0.5 * sin(u_time * 7.0 + uv.y * 2.0));
    col *= fl;
    float n = hash(gl_FragCoord.xy + fract(u_time) * 91.7);
    col += (n - 0.5) * u_flicker * 0.10;
  }

  // vignette
  float vig = 1.0 - u_vignette * smoothstep(0.32, 0.98, length(dir * vec2(1.05, 0.95)) * 1.35);
  col *= vig;

  // black bezel outside the curved area
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);

  fragColor = vec4(col, 1.0);
}`;
