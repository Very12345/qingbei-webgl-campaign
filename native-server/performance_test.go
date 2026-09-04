package main

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// Optional replay stays outside the repository; otherwise use the ordinary seed.
func BenchmarkHostFrame(b *testing.B) {
	seed, grid, err := loadKernelSeed()
	if err != nil {
		b.Fatal(err)
	}
	if path := os.Getenv("QINGBEI_PERF_REPLAY"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			b.Fatal(err)
		}
		var saved struct{ State map[string]any }
		if err = json.Unmarshal(data, &saved); err != nil || saved.State == nil {
			b.Fatal("invalid replay", err)
		}
		seed = saved.State
	}
	rt, err := newJSKernelRuntime()
	if err != nil {
		b.Fatal(err)
	}
	defer rt.close()
	legacy := os.Getenv("QINGBEI_PERF_LEGACY_BUNDLE")
	reference := os.Getenv("QINGBEI_PERF_REFERENCE_BUNDLE")
	if legacy != "" && reference != "" {
		b.Fatal("choose a legacy path or an equivalent reference, not both")
	}
	bundlePath := legacy
	if reference != "" {
		bundlePath = reference
	}
	if bundlePath != "" {
		if rt.node != nil {
			b.Fatal("reference bundle benchmark requires Goja")
		}
		code, err := os.ReadFile(bundlePath)
		if err != nil {
			b.Fatal(err)
		}
		if _, err = rt.vm.RunString(string(code)); err != nil {
			b.Fatal(err)
		}
		rt.exports = rt.vm.Get("QingbeiKernel").ToObject(rt.vm)
	}
	instance, err := rt.create(seed, map[string]any{"aiTeams": []string{"thu"}, "navGrid": grid, "fixedStepMilliseconds": 100, "profile": true})
	if err != nil {
		b.Fatal(err)
	}
	_ = instance.dispatch(map[string]any{"type": "set_time_scale", "value": 4})
	_, _ = instance.networkFull()
	var sim, wire time.Duration
	var bytes int
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		if legacy != "" {
			if _, err := instance.step(100); err != nil {
				b.Fatal(err)
			}
		} else {
			if err := instance.advanceOnly(100); err != nil {
				b.Fatal(err)
			}
		}
		mid := time.Now()
		sim += mid.Sub(start)
		var encoded string
		if legacy != "" {
			delta, err := instance.networkDelta()
			if err != nil {
				b.Fatal(err)
			}
			data, err := json.Marshal(delta)
			if err != nil {
				b.Fatal(err)
			}
			encoded = string(data)
		} else if i%2 == 0 {
			var err error
			encoded, err = instance.networkDeltaJSON()
			if err != nil {
				b.Fatal(err)
			}
		}
		wire += time.Since(mid)
		bytes += len(encoded)
	}
	b.StopTimer()
	if legacy == "" {
		profile, err := instance.call("performanceProfile")
		if err == nil {
			if stages, ok := profile["stages"].(map[string]any); ok {
				for key, value := range stages {
					if ms, ok := value.(float64); ok {
						b.ReportMetric(ms/float64(b.N), key+"-ms/frame")
					}
				}
			}
		}
	}
	b.ReportMetric(float64(sim.Microseconds())/float64(b.N), "sim-us/frame")
	b.ReportMetric(float64(wire.Microseconds())/float64(b.N), "wire-us/frame")
	b.ReportMetric(float64(bytes)/float64(b.N), "wire-B/frame")
}
