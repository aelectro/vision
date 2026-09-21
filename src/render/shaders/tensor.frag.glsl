#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAnalysis;

// Outer product of the gradient with itself: the raw structure tensor.
// Smoothing this, rather than the gradient, is what makes the dominant
// orientation stable across a region instead of flipping sign along an edge.
void main() {
  vec3 a = texture(uAnalysis, vUv).rgb;
  float gx = a.g * 2.0 - 1.0;
  float gy = a.b * 2.0 - 1.0;

  // gx*gy is signed; the squares are not.
  fragColor = vec4(gx * gx, gy * gy, gx * gy * 0.5 + 0.5, 1.0);
}
