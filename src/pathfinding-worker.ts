/// <reference lib="webworker" />

export {};

type Grid = {
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  building: Uint8Array;
  water: Uint8Array;
  road: Uint8Array;
};

let grid: Grid | null = null;
const cache = new Map<string, [number, number][]>();

const pointAt = (index: number): [number, number] => [
  grid!.minX + ((index % grid!.cols) + 0.5) * grid!.cell,
  grid!.minZ + (Math.floor(index / grid!.cols) + 0.5) * grid!.cell,
];

const findPath = (
  start: number,
  goal: number,
  allowBuildingFallback: boolean,
): [number, number][] => {
  if (!grid || start < 0 || goal < 0) return [];
  if (start === goal) return [pointAt(goal)];
  const cacheKey = `${start}:${goal}:${allowBuildingFallback ? 1 : 0}`,
    cached = cache.get(cacheKey);
  if (cached) return cached.map(([x, z]) => [x, z]);
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
    blocked = (index: number) =>
      !allowBuildingFallback && grid!.building[index] !== 0,
    directions = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
  push({ index: start, score: 0 });
  while (heap.length) {
    const current = pop();
    if (!current || closed[current.index]) continue;
    if (current.index === goal) break;
    closed[current.index] = 1;
    const currentX = current.index % grid.cols,
      currentZ = Math.floor(current.index / grid.cols);
    for (const [offsetX, offsetZ] of directions) {
      const nextX = currentX + offsetX,
        nextZ = currentZ + offsetZ;
      if (
        nextX < 0 ||
        nextZ < 0 ||
        nextX >= grid.cols ||
        nextZ >= grid.rows
      )
        continue;
      const next = nextZ * grid.cols + nextX;
      if (blocked(next) || closed[next]) continue;
      if (
        offsetX &&
        offsetZ &&
        (blocked(currentZ * grid.cols + nextX) ||
          blocked(nextZ * grid.cols + currentX))
      )
        continue;
      const stepCost =
          Math.hypot(offsetX, offsetZ) *
          (grid.water[next]
            ? 7.2
            : grid.building[next]
              ? 5.8
              : grid.road[next]
                ? 0.68
                : 1.18),
        nextCost = cost[current.index] + stepCost;
      if (nextCost >= cost[next]) continue;
      cost[next] = nextCost;
      came[next] = current.index;
      push({
        index: next,
        score:
          nextCost + Math.hypot(goalX - nextX, goalZ - nextZ) * 0.68,
      });
    }
  }
  if (came[goal] < 0) return [];
  const reversed: [number, number][] = [];
  let cursor = goal;
  while (cursor !== start && cursor >= 0) {
    reversed.push(pointAt(cursor));
    cursor = came[cursor];
  }
  reversed.reverse();
  cache.set(cacheKey, reversed.map(([x, z]) => [x, z]));
  while (cache.size > 256) cache.delete(cache.keys().next().value!);
  return reversed;
};

self.onmessage = (
  event: MessageEvent<
    | { type: "init"; grid: Grid }
    | {
        type: "path";
        id: number;
        start: number;
        goal: number;
        allowBuildingFallback: boolean;
      }
  >,
) => {
  if (event.data.type === "init") {
    grid = event.data.grid;
    cache.clear();
    return;
  }
  const { id, start, goal, allowBuildingFallback } = event.data;
  self.postMessage({
    id,
    path: findPath(start, goal, allowBuildingFallback),
  });
};
