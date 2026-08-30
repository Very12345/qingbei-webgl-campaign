import PathfindingWorker from "./pathfinding-worker.ts?worker&inline";

export type WorkerNavGrid = {
  cell: number;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  building: Uint8Array;
  water: Uint8Array;
  road: Uint8Array;
};

type PendingPath = {
  resolve: (path: [number, number][]) => void;
  reject: (error: Error) => void;
};

export class PathfindingWorkerPool {
  readonly size: number;
  private workers: Worker[] = [];
  private pending = new Map<number, PendingPath>();
  private nextWorker = 0;
  private nextRequest = 0;
  private grid: WorkerNavGrid;

  constructor(grid: WorkerNavGrid) {
    const available = Math.max(2, navigator.hardwareConcurrency || 2);
    this.size = Math.max(1, available - 1);
    this.grid = grid;
  }

  private createWorker() {
    const worker = new PathfindingWorker();
    worker.onmessage = (
      event: MessageEvent<{ id: number; path: [number, number][] }>,
    ) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      request.resolve(event.data.path);
    };
    worker.onerror = () => {
      for (const [id, request] of this.pending) {
        this.pending.delete(id);
        request.reject(new Error("Pathfinding worker failed"));
      }
    };
    worker.postMessage({
      type: "init",
      grid: {
        ...this.grid,
        building: this.grid.building.slice(),
        water: this.grid.water.slice(),
        road: this.grid.road.slice(),
      },
    });
    this.workers.push(worker);
    return worker;
  }

  find(
    start: number,
    goal: number,
    allowBuildingFallback = false,
  ): Promise<[number, number][]> {
    const id = ++this.nextRequest,
      worker =
        this.workers.length < this.size
          ? this.createWorker()
          : this.workers[this.nextWorker++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({
        type: "path",
        id,
        start,
        goal,
        allowBuildingFallback,
      });
    });
  }

  dispose() {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    for (const request of this.pending.values())
      request.reject(new Error("Pathfinding pool disposed"));
    this.pending.clear();
  }
}
