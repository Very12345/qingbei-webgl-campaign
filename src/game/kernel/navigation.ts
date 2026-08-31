export type KernelNavGrid = {
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  blocked: Uint8Array;
  building: Uint8Array;
  water: Uint8Array;
  road: Uint8Array;
  elevation: Float32Array;
  component: Int32Array;
  mainComponent: number;
};

export const navIndex = (grid: KernelNavGrid, x: number, z: number) => {
  const gx = Math.floor((x - grid.minX) / grid.cell),
    gz = Math.floor((z - grid.minZ) / grid.cell);
  return gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows
    ? -1
    : gz * grid.cols + gx;
};

export const navPoint = (
  grid: KernelNavGrid,
  index: number,
): [number, number] => [
  grid.minX + ((index % grid.cols) + 0.5) * grid.cell,
  grid.minZ + (Math.floor(index / grid.cols) + 0.5) * grid.cell,
];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export const nearestOpenIndex = (
  grid: KernelNavGrid,
  x: number,
  z: number,
) => {
  const center = navIndex(grid, x, z);
  if (
    center >= 0 &&
    !grid.blocked[center] &&
    grid.component[center] === grid.mainComponent
  )
    return center;
  const cx = clamp(
      Math.floor((x - grid.minX) / grid.cell),
      0,
      grid.cols - 1,
    ),
    cz = clamp(
      Math.floor((z - grid.minZ) / grid.cell),
      0,
      grid.rows - 1,
    );
  for (let radius = 1; radius < 32; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const gx = cx + dx,
          gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows) continue;
        const index = gz * grid.cols + gx;
        if (
          !grid.blocked[index] &&
          grid.component[index] === grid.mainComponent
        )
          return index;
      }
  return -1;
};

export const nearestRoadIndex = (
  grid: KernelNavGrid,
  x: number,
  z: number,
) => {
  const cx = clamp(
      Math.floor((x - grid.minX) / grid.cell),
      0,
      grid.cols - 1,
    ),
    cz = clamp(
      Math.floor((z - grid.minZ) / grid.cell),
      0,
      grid.rows - 1,
    );
  for (let radius = 0; radius < 80; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const gx = cx + dx,
          gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows) continue;
        const index = gz * grid.cols + gx;
        if (
          grid.road[index] &&
          !grid.blocked[index] &&
          grid.component[index] === grid.mainComponent
        )
          return index;
      }
  return -1;
};

const clonePath = (path: readonly [number, number][]) =>
  path.map(([x, z]) => [x, z] as [number, number]);

export class KernelPathfinder {
  private cache = new Map<string, [number, number][]>();

  constructor(
    readonly grid: KernelNavGrid,
    readonly cacheLimit = 384,
  ) {}

  find(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    allowBuildingFallback = false,
  ): [number, number][] {
    const grid = this.grid,
      start = nearestOpenIndex(grid, fromX, fromZ),
      goal = nearestOpenIndex(grid, toX, toZ);
    if (start < 0 || goal < 0) return [];
    const key = `${start}:${goal}:${allowBuildingFallback ? 1 : 0}`,
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return clonePath(cached);
    }
    if (start === goal) return this.remember(key, [navPoint(grid, goal)]);

    const total = grid.cols * grid.rows,
      cost = new Float32Array(total),
      came = new Int32Array(total),
      closed = new Uint8Array(total),
      heap: { index: number; score: number }[] = [];
    cost.fill(Number.POSITIVE_INFINITY);
    came.fill(-1);
    cost[start] = 0;
    const goalX = goal % grid.cols,
      goalZ = Math.floor(goal / grid.cols),
      push = (entry: { index: number; score: number }) => {
        heap.push(entry);
        let index = heap.length - 1;
        while (index > 0) {
          const parent = Math.floor((index - 1) / 2);
          if (heap[parent].score <= entry.score) break;
          heap[index] = heap[parent];
          index = parent;
        }
        heap[index] = entry;
      },
      pop = () => {
        const first = heap[0],
          last = heap.pop()!;
        if (heap.length) {
          let index = 0;
          while (true) {
            let child = index * 2 + 1;
            if (child >= heap.length) break;
            if (
              child + 1 < heap.length &&
              heap[child + 1].score < heap[child].score
            )
              child++;
            if (heap[child].score >= last.score) break;
            heap[index] = heap[child];
            index = child;
          }
          heap[index] = last;
        }
        return first;
      },
      directions = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ],
      pathBlocked = (index: number) =>
        !allowBuildingFallback && grid.building[index];
    push({ index: start, score: 0 });
    while (heap.length) {
      const current = pop();
      if (!current || closed[current.index]) continue;
      if (current.index === goal) break;
      closed[current.index] = 1;
      const currentX = current.index % grid.cols,
        currentZ = Math.floor(current.index / grid.cols);
      for (const [dx, dz] of directions) {
        const nextX = currentX + dx,
          nextZ = currentZ + dz;
        if (
          nextX < 0 ||
          nextZ < 0 ||
          nextX >= grid.cols ||
          nextZ >= grid.rows
        )
          continue;
        const next = nextZ * grid.cols + nextX;
        if (pathBlocked(next) || closed[next]) continue;
        if (
          dx &&
          dz &&
          (pathBlocked(currentZ * grid.cols + nextX) ||
            pathBlocked(nextZ * grid.cols + currentX))
        )
          continue;
        const signedSlope =
            (grid.elevation[next] - grid.elevation[current.index]) /
            (grid.cell * Math.hypot(dx, dz)),
          slopeCost =
            signedSlope > 0
              ? 1 + signedSlope * 2.2
              : 1 + Math.abs(signedSlope) * 0.28,
          stepCost =
            Math.hypot(dx, dz) *
            (grid.water[next]
              ? 7.2
              : grid.building[next]
                ? 5.8
                : grid.road[next]
                  ? 0.68
                  : 1.18) *
            slopeCost,
          nextCost = cost[current.index] + stepCost;
        if (nextCost >= cost[next]) continue;
        cost[next] = nextCost;
        came[next] = current.index;
        push({
          index: next,
          score: nextCost + Math.hypot(goalX - nextX, goalZ - nextZ) * 0.68,
        });
      }
    }
    if (came[goal] < 0) {
      const fallback = allowBuildingFallback
        ? []
        : this.find(fromX, fromZ, toX, toZ, true);
      return this.remember(key, fallback);
    }
    const reversed: [number, number][] = [];
    let cursor = goal;
    while (cursor !== start && cursor >= 0) {
      reversed.push(navPoint(grid, cursor));
      cursor = came[cursor];
    }
    reversed.reverse();
    const goalPoint = navPoint(grid, goal),
      last = reversed.at(-1);
    if (!last || Math.hypot(last[0] - goalPoint[0], last[1] - goalPoint[1]) > 0.05)
      reversed.push(goalPoint);
    return this.remember(key, reversed);
  }

  private remember(key: string, path: [number, number][]) {
    this.cache.delete(key);
    this.cache.set(key, clonePath(path));
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      if (oldest == null) break;
      this.cache.delete(oldest);
    }
    return clonePath(path);
  }
}
