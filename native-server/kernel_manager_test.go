package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestServerOpeningHumanSeatsAndAuthoritativeStats(t *testing.T) {
	hub := newRelayHub()
	manager := newKernelManager(hub, nil, 2)
	defer manager.shutdown()
	battle, err := manager.create(battleSpec{Mode: "pvp", HumanTeams: []string{"pku", "thu"}, ServerOpening: "blitz", TimeScale: 4, MaxPlayers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(battle.aiTeams(nil)) != 0 || len(battle.aiTeams([]consolePlayer{{Team: "pku"}})) != 0 {
		t.Fatal("human vacancy was filled by AI")
	}
	aiBattle := &kernelBattle{spec: battleSpec{HumanTeams: []string{"thu"}}}
	if !reflect.DeepEqual(aiBattle.aiTeams(nil), []string{"pku"}) {
		t.Fatal("AI opponent not pinned to its assigned team")
	}
	full, err := battle.instance.networkFull()
	if err != nil {
		t.Fatal(err)
	}
	state := full["game"].(map[string]any)
	campaign := state["campaign"].(map[string]any)
	if campaign["elapsedHours"] != float64(84) || campaign["warUnlocked"] != true {
		t.Fatal("embedded kernel lacks blitz opening")
	}
	units := state["units"].([]any)
	if _, err = battle.instance.step(100); err != nil {
		t.Fatal(err)
	}
	after, _ := battle.instance.networkFull()
	nextUnits := after["game"].(map[string]any)["units"].([]any)
	if len(nextUnits) != len(units) {
		t.Fatal("extra initialization production")
	}
	for i, raw := range units {
		before, after := raw.(map[string]any), nextUnits[i].(map[string]any)
		if before["x"] != after["x"] || before["z"] != after["z"] || before["x"] != before["tx"] || before["z"] != before["tz"] {
			t.Fatal("stationary player soldier moved before receiving an order")
		}
	}
	mux := http.NewServeMux()
	registerInternalAPI(mux, manager, &pluginManager{secret: "stats-test"})
	for _, allowed := range []bool{false, true} {
		req := httptest.NewRequest("GET", "/api/internal/battles/"+battle.roomCode+"/stats", nil)
		if allowed {
			req.Header.Set("X-Qingbei-Plugin-Secret", "stats-test")
		}
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, req)
		if !allowed {
			if res.Code != 403 {
				t.Fatal("stats endpoint exposed")
			}
			continue
		}
		var stats map[string]any
		if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &stats) != nil || stats["version"] != float64(1) {
			t.Fatal(res.Body.String())
		}
	}
}

func TestHumanReadinessTracksSnapshotNotJustSocket(t *testing.T) {
	hub := newRelayHub()
	first, second := &wsClient{team: "pku", kernelReady: true}, &wsClient{team: "thu"}
	hub.rooms["SEATS"] = &relayRoom{guests: map[string]*wsClient{"a": first, "b": second}}
	battle := &kernelBattle{hub: hub, roomCode: "SEATS", spec: battleSpec{HumanTeams: []string{"pku", "thu"}}}
	if !battle.waitingForHumans() {
		t.Fatal("socket counted as ready before snapshot")
	}
	second.kernelReady = true
	if battle.waitingForHumans() {
		t.Fatal("ready players cannot start")
	}
	delete(hub.rooms["SEATS"].guests, "b")
	if !battle.waitingForHumans() {
		t.Fatal("battle kept running during reconnect grace")
	}
}

func TestKernelManagerCreatesIndependentRuntimes(t *testing.T) {
	hub := newRelayHub()
	manager := newKernelManager(hub, nil, 2)
	first, err := manager.create(battleSpec{Name: "一号", MaxPlayers: 2, AllowSameTeam: true, TimeScale: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.create(battleSpec{Name: "二号", MaxPlayers: 2, AllowSameTeam: true, TimeScale: 2})
	if err != nil {
		first.shutdown()
		t.Fatal(err)
	}
	defer manager.shutdown()
	if first.runtime == second.runtime || first.instance == second.instance {
		t.Fatal("each battle must own an independent JS runtime and kernel instance")
	}
	if len(manager.list()) != 2 || len(hub.consoleSnapshot()) != 2 {
		t.Fatal("manager and relay hub must expose both kernels")
	}
	if _, err := manager.create(battleSpec{Name: "超额", MaxPlayers: 2}); err == nil {
		t.Fatal("manager must enforce the configured kernel limit")
	}
}
