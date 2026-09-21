#version 300 es

out vec2 vUv;

// Single oversized triangle covering the viewport, generated from the vertex
// index alone. No vertex buffer, no attribute state to manage.
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
