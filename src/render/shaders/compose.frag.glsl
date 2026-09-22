#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform sampler2D uSoft;
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

// Where the recognised image sits, and how hard to separate it.
uniform vec2 uFocusCentre;
uniform float uFocusRadius;
uniform float uFocusStrength;
uniform float uSurroundFade;
// Aspect correction, so the region stays round on a portrait frame.
uniform vec2 uFocusScale;

// Animation. A still is time 0 with uMotion at 0, so the same program renders
// the saved image and every video frame.
uniform float uTime;
uniform float uMotion;
uniform float uParallax;
uniform float uZoom;
uniform float uBreathing;
uniform float uMotionSpeed;
uniform float uContourPulse;
// 0..1 ramp that draws the contours in at the start of a clip.
uniform float uReveal;

const float TWO_PI = 6.28318530718;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 rotateHue(vec3 color, float turns) {
  float angle = turns * TWO_PI;
  float c = cos(angle);
  float s = sin(angle);
  mat3 m = mat3(
    0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715,
    0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072
  );
  return clamp(m * color, 0.0, 1.0);
}

/**
 * 1 inside the found image, falling to 0 outside.
 *
 * This is the whole point of the pass. Without it every contour in the frame
 * is emphasised equally, and on a textured surface that reads as contrast and
 * shadow rather than as the thing the person saw.
 */
float focusMask(vec2 uv) {
  float distance = length((uv - uFocusCentre) * uFocusScale) / max(uFocusRadius, 0.02);
  return 1.0 - smoothstep(0.55, 1.15, distance);
}

vec2 warp(vec2 uv, float depth, float mask) {
  if (uMotion < 0.001) return uv;

  float phase = uTime * TWO_PI * uMotionSpeed;
  vec2 drift = vec2(sin(phase * 0.17), cos(phase * 0.13)) * uParallax * uTexel;
  vec2 parallax = drift * (depth - 0.5) * 2.0 * uMotion * uHasDepth;

  // Breathing belongs to the image, not the wall it was found in: scaling it
  // by the mask is what makes the shape itself seem to move.
  float breathe = 1.0 + uBreathing * 0.03 * mask * sin(phase * 0.5) * uMotion;
  float zoom = 1.0 + uZoom * (0.5 + 0.5 * sin(phase * 0.25)) * uMotion;

  vec2 about = mix(vec2(0.5), uFocusCentre, mask * 0.7);
  return (uv - about) / (zoom * breathe) + about + parallax;
}

void main() {
  float maskHere = focusMask(vUv);
  float depthHere = texture(uDepth, vUv).r;
  vec2 uv = clamp(warp(vUv, depthHere, maskHere), vec2(0.0), vec2(1.0));

  float mask = focusMask(uv);
  vec3 sharp = texture(uSrc, uv).rgb;
  vec3 soft = texture(uSoft, uv).rgb;
  float depth = texture(uDepth, uv).r;

  // Outside the region the photo loses its detail, so the surroundings have
  // something to recede into instead of merely being darker.
  float fade = uSurroundFade * uFocusStrength * (1.0 - mask);
  vec3 color = mix(sharp, soft, fade * 0.85);

  color = (color - 0.5) * uContrast + 0.5 + uBrightness;

  float grey = dot(color, LUMA);
  float saturation = uSaturation * (1.0 - fade * 0.8);
  color = mix(vec3(grey), color, saturation);
  color *= 1.0 - fade * 0.45;

  if (uPosterise > 0.001) {
    float steps = max(uLevels - 1.0, 1.0);
    vec3 banded = floor(color * steps + 0.5) / steps;
    color = mix(color, banded, uPosterise * mix(0.35, 1.0, mask));
  }

  color = mix(color, rotateHue(color, uPaletteHue), uPaletteStrength);
  color = clamp(color, 0.0, 1.0);

  if (uHasDepth > 0.5) {
    float focus = mix(1.0, smoothstep(0.0, 0.75, depth), uSubjectFocus);
    color = mix(vec3(dot(color, LUMA)) * 0.55, color, focus);
  }

  // Contours are drawn where the image is and suppressed where it is not.
  float line = texture(uEdges, uv).r;
  float emphasis = mix(1.0 - uFocusStrength * 0.85, 1.0 + uFocusStrength * 0.6, mask);
  float pulse = 1.0 + uContourPulse * uMotion * mask * sin(uTime * TWO_PI * uMotionSpeed * 2.0) * 0.5;
  float ink = clamp(line * uEdgeStrength * emphasis * pulse * uReveal, 0.0, 1.0);

  color = mix(color, vec3(0.02, 0.02, 0.03), ink);

  // A faint light along the strongest contours, so the shape reads as found
  // rather than merely outlined.
  float glow = smoothstep(0.55, 1.0, line) * mask * uFocusStrength * uReveal;
  color += vec3(0.30, 0.26, 0.20) * glow * 0.35;

  float radius = length(vUv - 0.5);
  color *= mix(1.0, smoothstep(0.95, 0.25, radius), uVignette);

  if (uGrain > 0.001) {
    float noise = hash(vUv * 1024.0 + uTime * 37.0) - 0.5;
    color += noise * uGrain;
  }

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
