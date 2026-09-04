package main

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

type machineSample struct {
	cpuSeconds            float64
	cpuKnown              bool
	rss, total, available uint64
	hostTotal, hostIdle   uint64
}
type serverPerformance struct {
	KernelEngine  string   `json:"kernelEngine"`
	SampledAt     int64    `json:"sampledAt"`
	CPUCores      int      `json:"cpuCores"`
	ProcessCPU    *float64 `json:"processCpuPercent"`
	HostCPU       *float64 `json:"hostCpuPercent"`
	RSS           uint64   `json:"processRSSBytes"`
	Heap          uint64   `json:"heapAllocBytes"`
	HostTotal     uint64   `json:"hostMemoryTotalBytes"`
	HostAvailable uint64   `json:"hostMemoryAvailableBytes"`
	GCPauseMS     float64  `json:"gcPauseMs"`
	Goroutines    int      `json:"goroutines"`
}
type performanceMonitor struct {
	mu    sync.RWMutex
	value serverPerformance
	stop  chan struct{}
}

func newPerformanceMonitor() *performanceMonitor {
	m := &performanceMonitor{stop: make(chan struct{})}
	go func() {
		previous, at := readMachineSample(), time.Now()
		var lastGC uint64
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			var mem runtime.MemStats
			runtime.ReadMemStats(&mem)
			now, sample := time.Now(), readMachineSample()
			value := serverPerformance{SampledAt: now.UnixMilli(), CPUCores: runtime.NumCPU(), RSS: sample.rss, Heap: mem.HeapAlloc, HostTotal: sample.total, HostAvailable: sample.available, Goroutines: runtime.NumGoroutine()}
			value.KernelEngine = "goja"
			if strings.EqualFold(strings.TrimSpace(os.Getenv("QINGBEI_KERNEL_ENGINE")), "node") {
				value.KernelEngine = "node"
			}
			if sample.cpuKnown && previous.cpuKnown && now.Sub(at) >= 100*time.Millisecond {
				v := 100 * (sample.cpuSeconds - previous.cpuSeconds) / now.Sub(at).Seconds()
				if v >= 0 {
					value.ProcessCPU = &v
				}
			}
			if sample.hostTotal > previous.hostTotal {
				v := 100 * (1 - float64(sample.hostIdle-previous.hostIdle)/float64(sample.hostTotal-previous.hostTotal))
				value.HostCPU = &v
			}
			if lastGC != 0 {
				value.GCPauseMS = float64(mem.PauseTotalNs-lastGC) / 1e6
			}
			lastGC = mem.PauseTotalNs
			m.mu.Lock()
			m.value = value
			m.mu.Unlock()
			previous, at = sample, now
			select {
			case <-m.stop:
				return
			case <-ticker.C:
			}
		}
	}()
	return m
}
func (m *performanceMonitor) snapshot() serverPerformance {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.value
}

type tickSample struct {
	at                  int64
	total, sim, network float64
	bytes               int
}
type battlePerformance struct {
	mu                                  sync.Mutex
	samples                             [120]tickSample
	next, count                         int
	paused                              bool
	commandsReceived, commandsProcessed int64
	lastCommandMS                       float64
}

func (b *kernelBattle) recordTick(start time.Time, sim, network time.Duration, bytes int, paused bool) {
	p := &b.performance
	p.mu.Lock()
	defer p.mu.Unlock()
	p.samples[p.next] = tickSample{at: time.Now().UnixMilli(), total: float64(time.Since(start).Microseconds()) / 1000, sim: float64(sim.Microseconds()) / 1000, network: float64(network.Microseconds()) / 1000, bytes: bytes}
	p.next = (p.next + 1) % len(p.samples)
	if p.count < len(p.samples) {
		p.count++
	}
	p.paused = paused
}
func (b *kernelBattle) performanceView() map[string]any {
	p := &b.performance
	p.mu.Lock()
	now := time.Now().UnixMilli()
	durations := []float64{}
	var sim, net float64
	var ticks, bytes int
	var last int64
	for _, s := range p.samples {
		if s.at > last {
			last = s.at
		}
		if s.at >= now-5000 {
			ticks++
			bytes += s.bytes
			sim += s.sim
			net += s.network
			durations = append(durations, s.total)
		}
	}
	sort.Float64s(durations)
	var p95 float64
	if len(durations) > 0 {
		p95 = durations[(len(durations)-1)*95/100]
		sim /= float64(len(durations))
		net /= float64(len(durations))
	}
	result := map[string]any{"lastTickAt": last, "tickHz": float64(ticks) / 5, "targetTickHz": 10, "stateTargetHz": 5, "tickP95Ms": p95, "simulationMs": sim, "serializationMs": net, "outboundBytesPerSecond": bytes / 5, "pausedForPlayers": p.paused, "commandsReceived": p.commandsReceived, "commandsProcessed": p.commandsProcessed, "lastCommandMs": p.lastCommandMS}
	p.mu.Unlock()
	b.mu.RLock()
	result["status"], result["error"] = b.status, b.lastError
	b.mu.RUnlock()
	var merged uint64
	var queued, controls int
	var write int64
	for _, client := range b.clients() {
		merged += client.mergedDeltas.Load()
		controls += len(client.outbound)
		v := client.lastWriteMicros.Load()
		if v > write {
			write = v
		}
		client.queueMu.Lock()
		if client.latestState != nil {
			queued += len(client.latestState.Data)
		}
		client.queueMu.Unlock()
	}
	result["mergedStatePackets"], result["queuedStateBytes"], result["queuedControlPackets"], result["lastWriteMs"] = merged, queued, controls, float64(write)/1000
	return result
}

func registerPerformanceAPI(mux *http.ServeMux, manager *kernelManager, monitor *performanceMonitor) {
	mux.HandleFunc("/api/performance", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		result := map[string]any{"version": version, "serverTime": time.Now().UnixMilli(), "server": monitor.snapshot(), "battle": nil}
		if battle := manager.get(r.URL.Query().Get("room")); battle != nil {
			result["battle"] = battle.performanceView()
		}
		_ = json.NewEncoder(w).Encode(result)
	})
}
