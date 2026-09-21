#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;

// Diagnostic only: shows an intermediate target as-is.
void main() {
  fragColor = vec4(texture(uSrc, vUv).rgb, 1.0);
}
