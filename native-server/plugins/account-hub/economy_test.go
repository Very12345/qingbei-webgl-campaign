package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestContributionRewardsAndBlitz(t *testing.T) {
	stats := &battleStats{Version: 1, Kills: map[string]int{"pku": 40}, Captures: map[string]int{"pku": 3}}
	if r := scoreReward(stats, "pku", "thu", "standard"); r.Experience != 43 || r.VictoryBonus != 0 {
		t.Fatal(r)
	}
	if r := scoreReward(stats, "pku", "pku", "standard"); r.Experience != 143 || r.Coins != 28 {
		t.Fatal(r)
	}
	if r := scoreReward(stats, "pku", "pku", "blitz"); r.Experience != 71 || r.Multiplier != .5 {
		t.Fatal(r)
	}
	if r := scoreReward(stats, "thu", "thu", "standard"); r.Experience != 0 || r.Coins != 0 {
		t.Fatal("zero contribution winner farmed rewards", r)
	}
}

func TestSurrenderUsesOnlyKernelStatsAndPersistsOnce(t *testing.T) {
	s, mux, m, token := lifecycleFixture(t)
	m.Stats = nil
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/battles/ACTIVE1234/stats" || r.Header.Get("X-Qingbei-Plugin-Secret") != "test-secret" {
			w.WriteHeader(403)
			return
		}
		_ = json.NewEncoder(w).Encode(battleStats{Version: 1, Kills: map[string]int{}, Captures: map[string]int{}})
	}))
	defer host.Close()
	s.serverOrigin = host.URL
	for i := 0; i < 2; i++ {
		res := requestJSON(t, mux, "POST", "/api/match/surrender", map[string]any{"roomCode": m.RoomCode, "kills": 99999, "experience": 99999}, token)
		if res.Code != 200 {
			t.Fatal(res.Body.String())
		}
	}
	if !m.Completed || s.data.Users["player"].Experience["pku"] != 0 || s.data.Users["player"].SchoolCoins["pku"] != 0 {
		t.Fatal("instant surrender yielded currency or XP")
	}
	reloaded, _ := newTestHub(t)
	reloaded.dataFile = s.dataFile
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	if !reloaded.data.Matches[m.RoomCode].Completed || reloaded.completeMatchLocked(reloaded.data.Matches[m.RoomCode], "pku", "duplicate") {
		t.Fatal("restart allowed duplicate settlement")
	}
}

func TestSettlementRollbackAndNoStarterCardRefill(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	u := s.data.Users["player"]
	u.Experience["pku"] = 300
	m.Stats = &battleStats{Version: 1, Kills: map[string]int{"pku": 5}, Captures: map[string]int{}}
	realFile := s.dataFile
	s.dataFile = t.TempDir()
	if s.completeMatchLocked(m, "thu", "test") || m.Completed || u.Experience["pku"] != 300 || u.SchoolCoins["pku"] != 0 {
		t.Fatal("failed save left rewards in memory")
	}
	s.dataFile = realFile
	if !s.completeMatchLocked(m, "thu", "retry") || u.Experience["pku"] != 305 || u.SchoolCoins["pku"] != 1 || u.SpeedCards["2x"] != 0 {
		t.Fatal("retry duplicated score or refilled a spent starter card")
	}
}

func TestShopAtomicIdempotentAndFactionBalance(t *testing.T) {
	s, mux := newTestHub(t)
	u := &userRecord{ID: "buyer", SchoolCoins: map[string]int{"pku": 500, "thu": 0}}
	s.data.Users[u.ID] = u
	token := s.newSessionLocked(u.ID)
	payload := map[string]any{"purchaseId": "purchase-0000000001", "team": "pku", "item": "2x", "quantity": 2, "price": 0}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if res := requestJSON(t, mux, "POST", "/api/shop/buy", payload, token); res.Code != 200 {
				t.Error(res.Body.String())
			}
		}()
	}
	wg.Wait()
	if u.SchoolCoins["pku"] != 300 || u.SpeedCards["2x"] != 2 || len(u.Purchases) != 1 {
		t.Fatal("purchase retries charged twice")
	}
	reloaded, rmux := newTestHub(t)
	reloaded.dataFile = s.dataFile
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	rtoken := reloaded.newSessionLocked(u.ID)
	if res := requestJSON(t, rmux, "POST", "/api/shop/buy", payload, rtoken); res.Code != 200 || reloaded.data.Users[u.ID].SchoolCoins["pku"] != 300 {
		t.Fatal("restart lost receipt")
	}
	for _, test := range []map[string]any{
		{"purchaseId": "purchase-0000000002", "team": "thu", "item": "2x", "quantity": 1},
		{"purchaseId": "purchase-0000000003", "team": "pku", "item": "2x", "quantity": -1},
		{"purchaseId": "purchase-0000000001", "team": "pku", "item": "4x", "quantity": 2},
	} {
		if res := requestJSON(t, mux, "POST", "/api/shop/buy", test, token); res.Code < 400 {
			t.Fatal("invalid purchase accepted")
		}
	}
	s.dataFile = t.TempDir()
	res := requestJSON(t, mux, "POST", "/api/shop/buy", map[string]any{"purchaseId": "purchase-0000000004", "team": "pku", "item": "2x", "quantity": 1}, token)
	if res.Code != 503 || u.SchoolCoins["pku"] != 300 || u.SpeedCards["2x"] != 2 {
		t.Fatal("save failure deducted balance")
	}
}

func TestBlitzRulesAndSeparatePVPQueues(t *testing.T) {
	s, mux := newTestHub(t)
	specs := []map[string]any{}
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var spec map[string]any
		if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
			w.WriteHeader(400)
			return
		}
		specs = append(specs, spec)
		_ = json.NewEncoder(w).Encode(map[string]string{"roomCode": fmt.Sprintf("ROOM%06d", len(specs))})
	}))
	defer host.Close()
	s.serverOrigin = host.URL
	tokens := map[string]string{}
	for _, id := range []string{"ai", "normal", "fast1", "fast2"} {
		s.data.Users[id] = &userRecord{ID: id, Experience: map[string]int{}, SpeedCards: map[string]int{"4x": 2}}
		tokens[id] = s.newSessionLocked(id)
	}
	res := requestJSON(t, mux, "POST", "/api/lobby/ai", map[string]string{"pace": "blitz", "team": "thu", "difficulty": "hard"}, tokens["ai"])
	if res.Code != 201 {
		t.Fatal(res.Body.String())
	}
	if specs[0]["difficulty"] != "standard" || specs[0]["timeScale"] != float64(4) || specs[0]["serverOpening"] != "blitz" || s.data.Users["ai"].SpeedCards["4x"] != 2 {
		t.Fatal("blitz was not fixed standard / free 4x", specs[0])
	}
	if teams := specs[0]["humanTeams"].([]any); len(teams) != 1 || teams[0] != "thu" {
		t.Fatal(teams)
	}
	for _, entry := range []struct {
		id, pace string
		code     int
	}{{"normal", "standard", 202}, {"fast1", "blitz", 202}, {"fast2", "blitz", 201}} {
		if res := requestJSON(t, mux, "POST", "/api/lobby/pvp", map[string]string{"pace": entry.pace, "preferredTeam": "any"}, tokens[entry.id]); res.Code != entry.code {
			t.Fatal(res.Body.String())
		}
	}
	if len(specs) != 2 || specs[1]["timeScale"] != float64(4) || s.waiting == nil || s.waiting.UserID != "normal" || s.waitingBlitz != nil {
		t.Fatal("normal and blitz matchmaking mixed")
	}
}
