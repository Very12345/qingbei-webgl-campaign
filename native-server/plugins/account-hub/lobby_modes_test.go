package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCancelQueuesAndReservedPair(t *testing.T) {
	s, mux := newTestHub(t)
	s.data.Users["player"] = &userRecord{ID: "player"}
	token := s.newSessionLocked("player")
	s.waiting = &queueEntry{UserID: "other", JoinedAt: time.Now()}
	s.waitingBlitz = &queueEntry{UserID: "player", JoinedAt: time.Now().Add(-50 * time.Second)}
	status := requestJSON(t, mux, "GET", "/api/lobby/status", nil, token)
	var view map[string]any
	_ = json.Unmarshal(status.Body.Bytes(), &view)
	if view["pace"] != "blitz" || view["waitedSeconds"].(float64) < 45 {
		t.Fatal(view)
	}
	if res := requestJSON(t, mux, "POST", "/api/lobby/cancel", nil, ""); res.Code != 401 {
		t.Fatal(res.Code)
	}
	if res := requestJSON(t, mux, "GET", "/api/lobby/cancel", nil, token); res.Code != 405 {
		t.Fatal(res.Code)
	}
	for i := 0; i < 2; i++ {
		if res := requestJSON(t, mux, "POST", "/api/lobby/cancel", nil, token); res.Code != 200 {
			t.Fatal(res.Body.String())
		}
	}
	if s.waitingBlitz != nil || s.waiting == nil || s.waiting.UserID != "other" {
		t.Fatal("cancel affected partner queue")
	}
	s.creating = map[string]bool{"player": true}
	if res := requestJSON(t, mux, "POST", "/api/lobby/cancel", nil, token); res.Code != 409 {
		t.Fatal("reserved pair falsely cancelled", res.Body.String())
	}
	delete(s.creating, "player")
	s.ready["player"] = map[string]string{"joinUrl": "/play/test"}
	res := requestJSON(t, mux, "POST", "/api/lobby/cancel", nil, token)
	_ = json.Unmarshal(res.Body.Bytes(), &view)
	if view["joinUrl"] != "/play/test" {
		t.Fatal("created battle lost", view)
	}
	delete(s.ready, "player")
	s.waitingBlitz = &queueEntry{UserID: "player", JoinedAt: time.Now().Add(-11 * time.Minute)}
	if s.queueStatusLocked("player")["queued"] != false || s.waitingBlitz != nil {
		t.Fatal("expired queue remained active")
	}
}

func TestBlitzAIForcesStandardOnHost(t *testing.T) {
	s, mux := newTestHub(t)
	s.data.Users["player"] = &userRecord{ID: "player", SpeedCards: map[string]int{}}
	token := s.newSessionLocked("player")
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["difficulty"] != "standard" || body["timeScale"] != float64(4) || body["serverOpening"] != "blitz" {
			t.Errorf("wrong host config: %v", body)
		}
		teams := body["humanTeams"].([]any)
		if len(teams) != 1 || teams[0] != "pku" {
			t.Errorf("AI team disabled: %v", teams)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"roomCode": "BLITZ12345"})
	}))
	defer host.Close()
	s.serverOrigin = host.URL
	res := requestJSON(t, mux, "POST", "/api/lobby/ai", map[string]string{"team": "pku", "pace": "blitz", "difficulty": "hard"}, token)
	if res.Code != 201 {
		t.Fatal(res.Body.String())
	}
}

func TestSettlementProgressionIsAuthoritative(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	s.data.Users["player"].Experience["pku"] = 90
	m.Stats.Kills["pku"] = 200
	if !s.completeMatchLocked(m, "pku", "test") {
		t.Fatal("settlement failed")
	}
	p := m.Rewards["player"].Progression
	if p == nil || p.Before != 90 || p.After != 390 || len(p.Levels) != 3 || p.Levels[0].Level != 1 || p.Levels[2].Level != 3 {
		t.Fatal(p)
	}
	if s.completeMatchLocked(m, "pku", "duplicate") || m.Rewards["player"].Progression.After != 390 {
		t.Fatal("duplicate award")
	}
	capped := rewardProgression(int(experienceForLevel(careerLevelLimit)), int(experienceForLevel(careerLevelLimit))+5)
	if len(capped.Levels) != 1 || capped.Levels[0].Next != capped.Levels[0].Start {
		t.Fatal(capped)
	}
}
