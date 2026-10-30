// Normals for the preview.
//
// A solid that came out of a boolean is covered in triangles of wildly different sizes, and shading each by its
// own face leaves the walls striped. Averaging every triangle meeting at a point would instead round off the
// corners that ought to be sharp. So a point's normal is the average of the faces around it weighted by the angle
// each one turns through, and only of the faces within the crease angle — the flat top stays flat, the wall stays
// a wall, and the edge between them stays an edge.
//

export function creasedGeometry(vertices, triangles, creaseDegrees = 55) {
  const faces = triangles.length / 3;
  const faceNormals = new Float64Array(faces * 3);
  const atPoint = new Map();
  const corners = [];

  // Points that share coordinates share their normals, even where the solid lists them separately.
  for (let i = 0; i < vertices.length; i += 3) {
    const key = [vertices[i], vertices[i + 1], vertices[i + 2]].map((v) => v.toFixed(5)).join(",");
    if (!atPoint.has(key)) atPoint.set(key, []);
    corners.push(atPoint.get(key));
  }

  for (let face = 0; face < faces; face++) {
    const ids = [triangles[face * 3], triangles[face * 3 + 1], triangles[face * 3 + 2]];
    const a = ids[0] * 3;
    const b = ids[1] * 3;
    const c = ids[2] * 3;
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a];
    const vy = vertices[c + 1] - vertices[a + 1];
    const vz = vertices[c + 2] - vertices[a + 2];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(...normal) || 1;
    for (let k = 0; k < 3; k++) faceNormals[face * 3 + k] = normal[k] / length;

    for (let corner = 0; corner < 3; corner++) {
      const i = ids[corner] * 3;
      const j = ids[(corner + 1) % 3] * 3;
      const k = ids[(corner + 2) % 3] * 3;
      const u = [0, 1, 2].map((d) => vertices[j + d] - vertices[i + d]);
      const v = [0, 1, 2].map((d) => vertices[k + d] - vertices[i + d]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const angle = Math.atan2(
        Math.hypot(...cross),
        u.reduce((total, x, d) => total + x * v[d], 0),
      );
      corners[ids[corner]].push({ face, angle });
    }
  }

  const positions = new Float32Array(triangles.length * 3);
  const normals = new Float32Array(triangles.length * 3);
  const crease = Math.cos((creaseDegrees * Math.PI) / 180);
  for (let i = 0; i < triangles.length; i++) {
    const vertex = triangles[i];
    const face = Math.floor(i / 3);
    const sum = [0, 0, 0];
    for (const { face: other, angle } of corners[vertex]) {
      let facing = 0;
      for (let k = 0; k < 3; k++) facing += faceNormals[face * 3 + k] * faceNormals[other * 3 + k];
      if (facing + 1e-8 >= crease) for (let k = 0; k < 3; k++) sum[k] += faceNormals[other * 3 + k] * angle;
    }
    const length = Math.hypot(...sum) || 1;
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = vertices[vertex * 3 + k];
      normals[i * 3 + k] = sum[k] / length;
    }
  }
  return { positions, normals };
}
