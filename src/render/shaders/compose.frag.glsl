#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform sampler2D uEdges;
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform vec2 uTexel;

uniform float uEdgeStrength;
uniform float uContrast;
uniform float uBrightness;
uniform float uSaturation;
uniform float uPosterise;
uniform float uLevels;
uniform float uPaletteHue;
uniform float uPaletteStrength;
uniform float uSubjectFocus;
uniform float uVignette;
uniform float uGrain;

// Animation. A still is simply time 0 with uMotion at 0, so the same program
// renders the saved image and every video frame.
uniform float uTime;
uniform float uMotion;
uniform float uParallax;
uniform float uZoom;
uniform float uBreathing;
uniform float uMotionSpeed;
uniform float uContourPulse;

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 rotateHue(vec3 color, float turns) {
  float angle = turns * TWO_PI;
  float c = cos(angle);
  float s = sin(angle);
  // Rotation about the luminance axis in RGB space.
  mat3 m = mat3(
    0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715,
    0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072
  );
  return clamp(m * color, 0.0, 1.0);
}

// Depth-driven 2.5D displacement: near parts of the image travel further than
// far ones, which reads as volume without any geometry.
vec2 warp(vec2 uv, float depth) {
  if (uMotion < 0.001) return uv;

  float phase = uTime * TWO_PI * uMotionSpeed;
  vec2 drift = vec2(sin(phase * 0.17), cos(phase * 0.13)) * uParallax * uTexel;
  // With no depth map every pixel would shift identically, which reads as a
  // wobble rather than volume; the camera move below carries the motion instead.
  vec2 parallax = drift * (depth - 0.5) * 2.0 * uMotion * uHasDepth;

  float breathe = 1.0 + uBreathing * 0.02 * sin(phase * 0.5) * uMotion;
  float zoom = 1.0 + uZoom * (0.5 + 0.5 * sin(phase * 0.25)) * uMotion;

  return (uv - 0.5) / (zoom * breathe) + 0.5 + parallax;
}

void main() {
  float depthHere = texture(uDepth, vUv).r;
  vec2 uv = clamp(warp(vUv, depthHere), vec2(0.0), vec2(1.0));

  vec3 color = texture(uSrc, uv).rgb;
  float depth = texture(uDepth, uv).r;

  color = (color - 0.5) * uContrast + 0.5 + uBrightness;

  float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(grey), color, uSaturation);

  if (uPosterise > 0.001) {
    // Quantise over levels-1 intervals so that pure white stays exactly white;
    // dividing by the level count instead would push it past 1.
    float steps = max(uLevels - 1.0, 1.0);
    vec3 banded = floor(color * steps + 0.5) / steps;
    color = mix(color, banded, uPosterise);
  }

  color = mix(color, rotateHue(color, uPaletteHue), uPaletteStrength);
  color = clamp(color, 0.0, 1.0);

  // Push the background back so whatever the depth map considers near reads
  // as the subject. Without a depth map there is no subject to find, and
  // applying this anyway would just dim the whole frame.
  if (uHasDepth > 0.5) {
    float focus = mix(1.0, smoothstep(0.0, 0.75, depth), uSubjectFocus);
    color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))) * 0.55, color, focus);
  }

  float line = texture(uEdges, uv).r;
  float pulse = 1.0 + uContourPulse * uMotion * sin(uTime * TWO_PI * uMotionSpeed * 2.0) * 0.5;
  color = mix(color, vec3(0.02, 0.02, 0.03), clamp(line * uEdgeStrength * pulse, 0.0, 1.0));

  float radius = length((vUv - 0.5) * vec2(1.0, 1.0));
  color *= mix(1.0, smoothstep(0.95, 0.25, radius), uVignette);

  if (uGrain > 0.001) {
    // Offsetting by time keeps the grain from freezing into a static pattern
    // across the video.
    float noise = hash(vUv * 1024.0 + uTime * 37.0) - 0.5;
    color += noise * uGrain;
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
