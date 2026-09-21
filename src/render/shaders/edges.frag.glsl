#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAnalysis;
uniform sampler2D uTensor;
uniform vec2 uTexel;

uniform float uThreshold;
uniform float uWidth;
uniform float uCoherence;

const float K = 1.6;

float sampleLuma(vec2 uv) {
  return texture(uAnalysis, uv).r;
}

// One-dimensional Gaussian taken along an arbitrary axis, which is what makes
// the difference-of-Gaussians follow the shape of the image instead of the
// pixel grid.
float blurAlong(vec2 uv, vec2 axis, float sigma) {
  float sum = sampleLuma(uv);
  float total = 1.0;

  for (int i = 1; i <= 5; i++) {
    float offset = float(i);
    float weight = exp(-0.5 * (offset * offset) / (sigma * sigma));
    sum += sampleLuma(uv + axis * offset) * weight;
    sum += sampleLuma(uv - axis * offset) * weight;
    total += 2.0 * weight;
  }

  return sum / total;
}

void main() {
  vec3 t = texture(uTensor, vUv).rgb;
  float e = t.r;
  float g = t.g;
  float f = t.b * 2.0 - 1.0;

  // Eigen-decomposition of the 2x2 structure tensor [[e, f], [f, g]].
  float diff = e - g;
  float root = sqrt(max(diff * diff + 4.0 * f * f, 0.0));
  float lambda1 = 0.5 * (e + g + root);
  float lambda2 = 0.5 * (e + g - root);

  // 1 where the neighbourhood agrees on a single orientation, 0 where it is
  // isotropic and the direction below would be meaningless.
  float coherence = (lambda1 + lambda2) > 1e-6
    ? (lambda1 - lambda2) / (lambda1 + lambda2)
    : 0.0;

  vec2 gradientDir = normalize(vec2(f, lambda1 - e) + vec2(1e-6, 1e-6));

  // Cross the line rather than along it: sampling perpendicular to the edge
  // is what produces a thin, decisive contour.
  vec2 axis = mix(vec2(1.0, 0.0), gradientDir, uCoherence * coherence);

  float sigma = max(uWidth, 0.4);
  vec2 stepVec = axis * uTexel;

  float near = blurAlong(vUv, stepVec, sigma);
  float far = blurAlong(vUv, stepVec, sigma * K);

  // A plain difference of Gaussians, with no tau coefficient. Scaling one term
  // by tau < 1 leaves a pedestal proportional to local brightness, so flat and
  // smoothly graded areas would report edges purely for being bright. This
  // form is exactly zero wherever luminance is constant or linear, which is
  // what makes the threshold mean the same thing everywhere in the image.
  float dog = far - near;

  float t1 = uThreshold + max(0.006, uThreshold * 1.5);
  float line = smoothstep(uThreshold, t1, dog);

  fragColor = vec4(clamp(line, 0.0, 1.0), coherence, 0.0, 1.0);
}
