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
	if health["apiVersion"] != float64(2) {
		t.Fatalf("unexpected kernel API version: %#v", health)
	}
	if health["authoritative"] != true {
		t.Fatalf("kernel is not authoritative: %#v", health)
	}
	if health["orderRulesVersion"] != float64(1) {
		t.Fatalf("embedded kernel is stale: rebuild it with npm run build:kernel: %#v", health)
	}
	if health["decisionCancellation"] != true {
		t.Fatal("embedded kernel lacks decision cancellation")
	}
	if health["aiTacticsVersion"] != float64(1) {
		t.Fatal("embedded kernel lacks route-aware camp tactics")
	}
	if health["serverScenariosVersion"] != float64(1) {
		t.Fatal("embedded kernel lacks server scenarios and battle stats")
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

func TestEmbeddedStandardAIPlansAfterWarStarts(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	seed, grid, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	campaign := seed["campaign"].(map[string]any)
	campaign["warUnlocked"] = true
	campaign["elapsedHours"] = 100
	campaign["ai"].(map[string]any)["difficultyByTeam"] = map[string]any{"pku": "standard", "thu": "standard"}
	instance, err := runtime.create(seed, map[string]any{"aiTeams": []string{"pku", "thu"}, "navGrid": grid})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = instance.run(4, 250); err != nil {
		t.Fatalf("embedded route/camp planner failed: %v", err)
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

func TestEmbeddedKernelProducesAuthoritativeNetworkEnvelopes(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	seed, navGrid, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	instance, err := runtime.create(seed, map[string]any{
		"aiTeams":               []string{"thu"},
		"navGrid":               navGrid,
		"fixedStepMilliseconds": 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	full, err := instance.networkFull()
	if err != nil {
		t.Fatal(err)
	}
	if full["type"] != "state" || full["role"] != "host" {
		t.Fatalf("unexpected full network envelope: %#v", full)
	}
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": 4}); err != nil {
		t.Fatal(err)
	}
	if _, err := instance.step(250); err != nil {
		t.Fatal(err)
	}
	delta, err := instance.networkDelta()
	if err != nil {
		t.Fatal(err)
	}
	if delta["type"] != "state_delta" || delta["role"] != "host" {
		t.Fatalf("unexpected delta network envelope: %#v", delta)
	}
	if delta["revision"].(float64) < 1 {
		t.Fatalf("network revision did not advance: %#v", delta)
	}
}

func TestEmbeddedKernelPreservesPlayerRouteAcrossProductionDays(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	seed, navGrid, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	campaign := seed["campaign"].(map[string]any)
	campaign["freezeUntil"] = map[string]any{"pku": 1e9, "thu": 1e9}
	sites := seed["sites"].([]any)
	ids := []any{}
	for _, raw := range sites {
		site := raw.(map[string]any)
		if site["team"] == "pku" {
			ids = append(ids, site["id"])
		}
		if len(ids) == 2 {
			break
		}
	}
	if len(ids) < 2 {
		t.Fatal("seed has fewer than two PKU sites")
	}
	instance, err := runtime.create(seed, map[string]any{"aiTeams": []string{}, "navGrid": navGrid})
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.dispatch(map[string]any{"type": "configure_site", "team": "pku", "siteId": ids[0], "orderTarget": ids[1]}); err != nil {
		t.Fatal(err)
	}
	if err = instance.dispatch(map[string]any{"type": "set_time_scale", "value": 64}); err != nil {
		t.Fatal(err)
	}
	result, err := instance.run(100, 250)
	if err != nil {
		t.Fatal(err)
	}
	state := result["state"].(map[string]any)
	for _, raw := range state["sites"].([]any) {
		site := raw.(map[string]any)
		if site["id"] == ids[0] {
			if site["orderTarget"] != ids[1] || site["orderOwner"] != "player" {
				t.Fatalf("embedded runtime lost persistent player line: %#v", site)
			}
			return
		}
	}
	t.Fatal("source site missing from embedded runtime")
}

func TestNativeDecisionCancellationUsesAuthenticatedTeamAndRefundsOnce(t *testing.T) {
	runtime, err := newJSKernelRuntime()
	if err != nil {
		t.Fatal(err)
	}
	seed, _, err := loadKernelSeed()
	if err != nil {
		t.Fatal(err)
	}
	seed["resources"] = map[string]any{"pku": 1000, "thu": 1000}
	instance, err := runtime.create(seed, map[string]any{"aiTeams": []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.dispatch(map[string]any{"type": "decision_start", "team": "pku", "id": "pku_science_foundation"}); err != nil {
		t.Fatal(err)
	}
	snap, err := instance.step(1)
	if err != nil {
		t.Fatal(err)
	}
	state := snap["state"].(map[string]any)
	active := state["campaign"].(map[string]any)["decisions"].(map[string]any)["active"].(map[string]any)["pku"].(map[string]any)
	command := map[string]any{"kind": "decision_cancel", "team": "pku", "id": active["id"], "startedAt": active["startedAt"], "instanceId": active["instanceId"]}
	battle := &kernelBattle{instance: instance}
	battle.handleAction(&wsClient{team: "thu"}, command)
	snap, err = instance.step(1)
	if err != nil {
		t.Fatal(err)
	}
	if snap["state"].(map[string]any)["resources"].(map[string]any)["pku"] != float64(920) {
		t.Fatal("other team cancelled the decision")
	}
	client := &wsClient{team: "pku"}
	battle.handleAction(client, command)
	battle.handleAction(client, command)
	snap, err = instance.step(1)
	if err != nil {
		t.Fatal(err)
	}
	state = snap["state"].(map[string]any)
	if state["resources"].(map[string]any)["pku"] != float64(960) {
		t.Fatal("cancellation refund missing or duplicated")
	}
	if state["campaign"].(map[string]any)["decisions"].(map[string]any)["active"].(map[string]any)["pku"] != nil {
		t.Fatal("decision is still active")
	}
}
