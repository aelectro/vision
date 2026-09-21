#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uTexel;
// Sampling axis in pixels: (1,0) for the horizontal half, (0,1) for the other.
uniform vec2 uDirection;
uniform float uSigma;

// Nine-tap Gaussian. Weights are computed rather than baked so the same
// program serves every radius the parameter schema can ask for.
void main() {
  float sigma = max(uSigma, 0.0001);
  vec2 step = uDirection * uTexel;

  vec4 sum = texture(uSrc, vUv);
  float total = 1.0;

  for (int i = 1; i <= 4; i++) {
    float offset = float(i);
    float weight = exp(-0.5 * (offset * offset) / (sigma * sigma));
    sum += texture(uSrc, vUv + step * offset) * weight;
    sum += texture(uSrc, vUv - step * offset) * weight;
    total += 2.0 * weight;
  }

  fragColor = sum / total;
}
