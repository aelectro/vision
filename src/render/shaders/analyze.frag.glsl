#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;
uniform vec2 uTexel;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Luminance plus its Sobel gradient. Gradients are signed, so they are packed
// into [0,1] for the RGBA8 target; every later pass that averages them uses
// weights summing to one, which commutes with this affine encoding.
void main() {
  float tl = luma(texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  float tc = luma(texture(uSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb);
  float tr = luma(texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  float ml = luma(texture(uSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb);
  float mc = luma(texture(uSrc, vUv).rgb);
  float mr = luma(texture(uSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb);
  float bl = luma(texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  float bc = luma(texture(uSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb);
  float br = luma(texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);

  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);

  // Sobel on luminance in [0,1] spans [-4,4].
  gx *= 0.25;
  gy *= 0.25;

  fragColor = vec4(mc, gx * 0.5 + 0.5, gy * 0.5 + 0.5, 1.0);
}
