import * as THREE from "three";

export type GroundMarking = { points: [number, number][]; closed?: boolean };

// Painted ground geometry, not an unlit LineBasicMaterial overlay. One mesh per
// field keeps all lanes/penalty boxes under the same lights and shadow receiver.
export function createSportMarkings(paths: GroundMarking[], height: number, width = .012) {
  const positions: number[] = [], indices: number[] = [];
  for (const path of paths) {
    const points = path.points;
    const count = path.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const nx = -dz / length * width / 2, nz = dx / length * width / 2, start = positions.length / 3;
      positions.push(a[0]+nx,height,a[1]+nz, a[0]-nx,height,a[1]-nz,
        b[0]+nx,height,b[1]+nz, b[0]-nx,height,b[1]-nz);
      indices.push(start,start+2,start+1, start+1,start+2,start+3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color:0xe0dacb, roughness:1, metalness:0, emissive:0x000000,
    side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-1,
  }));
  mesh.name = "运动场地面标线";
  mesh.receiveShadow = true;
  mesh.renderOrder = 4;
  return mesh;
}
