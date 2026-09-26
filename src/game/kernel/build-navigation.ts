import type { KernelNavGrid } from "./navigation";

const pointInPolygon = (x: number, z: number, points: number[][]) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i],
      [xj, zj] = points[j];
    if (
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + Number.EPSILON) + xi
    )
      inside = !inside;
  }
  return inside;
};

const footprintArea = (points: number[][]) =>
  Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2,
  );

export const gameplayBuildingsForNavigation = (region: any) =>
  region.buildings.filter((building: any) => {
    const smallAnonymous =
      !building.name && footprintArea(building.points) < 0.13;
    return !smallAnonymous || Math.abs(building.osmId) % 4 !== 0;
  });

const terrainHeight = (region: any, x: number, z: number) => {
  const { cols, rows, heights } = region.terrain,
    clamp = (value: number) => Math.max(0, Math.min(1, value)),
    u =
      clamp((x - (region.offsetX - region.width / 2)) / region.width) *
      (cols - 1),
    v = clamp((region.depth / 2 - z) / region.depth) * (rows - 1),
    i = Math.floor(u),
    j = Math.floor(v),
    fu = u - i,
    fv = v - j,
    at = (ii: number, jj: number) =>
      (heights[Math.min(rows - 1, jj) * cols + Math.min(cols - 1, ii)] ||
        0) * 6,
    lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
  return lerp(
    lerp(at(i, j), at(i + 1, j), fu),
    lerp(at(i, j + 1), at(i + 1, j + 1), fu),
    fv,
  );
};

export function buildKernelNavGrid(region: any): KernelNavGrid {
  const cell = 0.7,
    minX = region.offsetX - region.width / 2,
    minZ = -region.depth / 2,
    cols = Math.ceil(region.width / cell),
    rows = Math.ceil(region.depth / cell),
    blocked = new Uint8Array(cols * rows),
    building = new Uint8Array(cols * rows),
    water = new Uint8Array(cols * rows),
    road = new Uint8Array(cols * rows),
    elevation = new Float32Array(cols * rows),
    markPolygons = (polygons: readonly any[], mask: Uint8Array) => {
      for (const polygon of polygons) {
        const xs = polygon.points.map((point: number[]) => point[0]),
          zs = polygon.points.map((point: number[]) => point[1]),
          x0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / cell) - 1),
          x1 = Math.min(
            cols - 1,
            Math.ceil((Math.max(...xs) - minX) / cell) + 1,
          ),
          z0 = Math.max(0, Math.floor((Math.min(...zs) - minZ) / cell) - 1),
          z1 = Math.min(
            rows - 1,
            Math.ceil((Math.max(...zs) - minZ) / cell) + 1,
          );
        for (let gz = z0; gz <= z1; gz++)
          for (let gx = x0; gx <= x1; gx++) {
            const x = minX + (gx + 0.5) * cell,
              z = minZ + (gz + 0.5) * cell;
            if (pointInPolygon(x, z, polygon.points)) {
              blocked[gz * cols + gx] = 1;
              mask[gz * cols + gx] = 1;
            }
          }
      }
    };
  markPolygons(gameplayBuildingsForNavigation(region), building);
  markPolygons(region.waters, water);
  for (let gz = 0; gz < rows; gz++)
    for (let gx = 0; gx < cols; gx++)
      elevation[gz * cols + gx] = terrainHeight(
        region,
        minX + (gx + 0.5) * cell,
        minZ + (gz + 0.5) * cell,
      );
  for (const route of region.roads)
    for (let index = 1; index < route.points.length; index++) {
      const [x1, z1] = route.points[index - 1],
        [x2, z2] = route.points[index],
        length = Math.hypot(x2 - x1, z2 - z1),
        steps = Math.max(1, Math.ceil(length / (cell * 0.35)));
      for (let step = 0; step <= steps; step++) {
        const amount = step / steps,
          gx = Math.floor((x1 + (x2 - x1) * amount - minX) / cell),
          gz = Math.floor((z1 + (z2 - z1) * amount - minZ) / cell);
        if (gx >= 0 && gz >= 0 && gx < cols && gz < rows)
          road[gz * cols + gx] = 1;
      }
    }
  const component = new Int32Array(cols * rows);
  component.fill(-1);
  let componentId = 0,
    mainComponent = -1,
    mainSize = 0;
  const queue = new Int32Array(cols * rows),
    directions = [-1, 1, -cols, cols];
  for (let start = 0; start < component.length; start++) {
    if (blocked[start] || component[start] !== -1) continue;
    let head = 0,
      tail = 0,
      size = 0;
    queue[tail++] = start;
    component[start] = componentId;
    while (head < tail) {
      const current = queue[head++],
        currentX = current % cols;
      size++;
      for (const delta of directions) {
        const next = current + delta;
        if (next < 0 || next >= component.length) continue;
        if (
          (delta === -1 && currentX === 0) ||
          (delta === 1 && currentX === cols - 1) ||
          blocked[next] ||
          component[next] !== -1
        )
          continue;
        component[next] = componentId;
        queue[tail++] = next;
      }
    }
    if (size > mainSize) {
      mainSize = size;
      mainComponent = componentId;
    }
    componentId++;
  }
  return {
    cell,
    cols,
    rows,
    minX,
    minZ,
    blocked,
    building,
    water,
    road,
    elevation,
    component,
    mainComponent,
  };
}
