package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestNodeRuntimeMatchesSharedKernelAndDisposesInstances(t *testing.T) {
	path, err := exec.LookPath("node")
	if configured := os.Getenv("QINGBEI_NODE_PATH"); configured != "" {
		path, err = configured, nil
	}
	if err != nil {
		t.Skip("Node is optional on portable builds")
	}
	t.Setenv("QINGBEI_KERNEL_ENGINE", "goja")
	reference, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	defer reference.close()
	t.Setenv("QINGBEI_KERNEL_ENGINE", "node")
	t.Setenv("QINGBEI_NODE_PATH", path)
	accelerated, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	defer accelerated.close()
	health, err := accelerated.healthCheck()
	if err != nil || health["engine"] != "node" {
		t.Fatal(health, err)
	}
	seed, grid, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	options := map[string]any{"aiTeams": []string{}, "navGrid": grid, "serverOpening": "blitz", "randomSeed": 42, "networkEpoch": 1}
	a, err := reference.create(seed, options)
	if err != nil {
		t.Fatal(err)
	}
	b, err := accelerated.create(seed, options)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = a.networkFull()
	_, _ = b.networkFull()
	for _, instance := range []*jsKernelInstance{a, b} {
		if _, err := instance.call("dispatchMany", []any{map[string]any{"type": "set_time_scale", "value": 4}, map[string]any{"type": "configure_site", "team": "pku", "siteId": 0, "orderTarget": 1, "stance": "standby", "dispatchRatio": 1}}, "test/1"); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 15; i++ {
		if err = a.advanceOnly(100); err != nil {
			t.Fatal(err)
		}
		if err = b.advanceOnly(100); err != nil {
			t.Fatal(err)
		}
		x, err := a.networkDeltaJSON()
		if err != nil {
			t.Fatal(err)
		}
		y, err := b.networkDeltaJSON()
		if err != nil {
			t.Fatal(err)
		}
		var xm, ym any
		_ = json.Unmarshal([]byte(x), &xm)
		_ = json.Unmarshal([]byte(y), &ym)
		if !reflect.DeepEqual(xm, ym) {
			t.Fatalf("Node and Goja diverged at frame %d", i)
		}
	}
	receipts, err := b.call("drainCommandReceipts")
	if err != nil || len(receipts["tokens"].([]any)) != 1 {
		t.Fatal(receipts, err)
	}
	independent, err := accelerated.create(seed, options)
	if err != nil {
		t.Fatal(err)
	}
	b.dispose()
	if _, err = b.snapshot(); err == nil {
		t.Fatal("disposed instance remained callable")
	}
	if _, err = independent.snapshot(); err != nil {
		t.Fatal("disposing one instance destroyed another", err)
	}
	accelerated.close()
	select {
	case <-accelerated.node.done:
	case <-time.After(time.Second):
		t.Fatal("Node worker leaked after close")
	}
	if _, err = independent.snapshot(); err == nil {
		t.Fatal("closed engine remained callable")
	}
}

func TestExplicitNodeConfigurationFailsClearlyWhenMissing(t *testing.T) {
	t.Setenv("QINGBEI_KERNEL_ENGINE", "node")
	t.Setenv("QINGBEI_NODE_PATH", filepath.Join(t.TempDir(), "missing-node"))
	if _, err := newJSKernelRuntime(); err == nil {
		t.Fatal("missing configured engine silently fell back")
	}
}
