package main

import "testing"

func TestEmbeddedKernelHealthCheck(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	health, err := runtime.healthCheck()
	if err != nil {
		t.Fatal(err)
	}
	if health["language"] != "typescript" {
		t.Fatalf("unexpected kernel language: %#v", health)
	}
	if health["apiVersion"] != float64(1) {
		t.Fatalf("unexpected kernel API version: %#v", health)
	}
}

func TestEmbeddedKernelCanAdvanceState(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	instance, err := runtime.create(map[string]any{
		"timeOfDay": 0,
		"resources": map[string]any{"pku": 0, "thu": 0},
		"deaths":    map[string]any{"pku": 0, "thu": 0},
		"sites":     []any{},
		"units":     []any{},
		"campaign": map[string]any{
			"elapsedHours": 0,
			"ai": map[string]any{
				"difficulty": "standard",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": 16}); err != nil {
		t.Fatal(err)
	}
	state, err := instance.step(250)
	if err != nil {
		t.Fatal(err)
	}
	if state["revision"] != float64(1) {
		t.Fatalf("unexpected revision: %#v", state)
	}
	if state["elapsedHours"].(float64) <= 0 {
		t.Fatalf("kernel did not advance time: %#v", state)
	}
}

func TestEmbeddedKernelSeedCanRunWithoutBrowser(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	seed, navGrid, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	instance, err := runtime.create(seed, map[string]any{
		"aiTeams": []string{"pku", "thu"},
		"navGrid": navGrid,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": 16}); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 10; index++ {
		if _, err := instance.step(250); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := instance.snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot["revision"] != float64(10) {
		t.Fatalf("unexpected seed revision: %#v", snapshot)
	}
}
