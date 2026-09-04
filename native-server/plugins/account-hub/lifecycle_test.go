package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func lifecycleFixture(t *testing.T) (*hubServer, *http.ServeMux, *matchRecord, string) {
	s, mux := newTestHub(t)
	s.data.Users["player"] = &userRecord{ID: "player", Experience: map[string]int{}, SpeedCards: map[string]int{}}
	m := &matchRecord{RoomCode: "ACTIVE1234", Stats: &battleStats{Version: 1, Kills: map[string]int{}, Captures: map[string]int{}}, Mode: "ai", Difficulty: "hard", Participants: map[string]string{"player": "pku"}, CreatedAt: time.Now().Add(-time.Hour)}
	ensureMatchMaps(m)
	s.data.Matches[m.RoomCode] = m
	return s, mux, m, s.newSessionLocked("player")
}

func TestStoppedWorkerInterruptsWithoutAwardingForfeit(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"battles":[{"roomCode":"ACTIVE1234","status":"内核已停止"}]}`))
	}))
	defer host.Close()
	s.serverOrigin = host.URL
	if !s.reconcileBattles(time.Now()) || !m.Completed || m.Winner != "" || s.data.Users["player"].Experience["pku"] != 0 {
		t.Fatal("worker failure became a player loss")
	}
}

func TestLateHeartbeatCannotEscapeForfeit(t *testing.T) {
	s, mux, m, token := lifecycleFixture(t)
	m.SeenPlayers["player"] = true
	m.DisconnectedAt["player"] = time.Now().Add(-61 * time.Second)
	res := requestJSON(t, mux, "POST", "/api/match/heartbeat", map[string]string{"roomCode": m.RoomCode}, token)
	if res.Code != 200 || !m.Completed || m.Winner != "thu" {
		t.Fatal(res.Body.String())
	}
	requestJSON(t, mux, "POST", "/api/match/surrender", map[string]string{"roomCode": m.RoomCode}, token)
	if s.data.Users["player"].Experience["pku"] != 0 {
		t.Fatal("duplicate reward")
	}
}

func TestOldTabAndRepeatedDisconnect(t *testing.T) {
	_, mux, m, token := lifecycleFixture(t)
	m.Connections["player"] = "new-page"
	requestJSON(t, mux, "POST", "/api/match/disconnect", map[string]string{"roomCode": m.RoomCode, "connectionId": "old-page"}, token)
	if !m.DisconnectedAt["player"].IsZero() {
		t.Fatal("old tab disconnected new tab")
	}
	requestJSON(t, mux, "POST", "/api/match/disconnect", map[string]string{"roomCode": m.RoomCode, "connectionId": "new-page"}, token)
	first := m.DisconnectedAt["player"]
	requestJSON(t, mux, "POST", "/api/match/disconnect", map[string]string{"roomCode": m.RoomCode, "connectionId": "new-page"}, token)
	if !m.DisconnectedAt["player"].Equal(first) {
		t.Fatal("deadline was extended")
	}
}

func TestDeadConnectionHeartbeatFallback(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	m.Connections["player"] = "crashed-page"
	m.SeenPlayers["player"] = true
	m.LastHeartbeat["player"] = time.Now().Add(-71 * time.Second)
	if !s.expireMatchLocked(m, time.Now()) || m.Winner != "thu" {
		t.Fatal("crash escaped disconnect deadline")
	}
}

func TestPresenceCloseAndReturn(t *testing.T) {
	s, mux, m, token := lifecycleFixture(t)
	host := httptest.NewServer(mux)
	defer host.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", host.URL+"/api/match/presence?room="+m.RoomCode+"&connectionId=page-one", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := host.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(res.Body).ReadString('\n')
	if err != nil || !strings.HasPrefix(line, "data:") {
		t.Fatal(line, err)
	}
	cancel()
	res.Body.Close()
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		disconnected := !m.DisconnectedAt["player"].IsZero()
		s.mu.Unlock()
		if disconnected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("stream close not detected")
		}
		time.Sleep(time.Millisecond)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	req2, _ := http.NewRequestWithContext(ctx2, "GET", host.URL+"/api/match/presence?room="+m.RoomCode+"&connectionId=page-two", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	res2, err := host.Client().Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !m.DisconnectedAt["player"].IsZero() || m.Completed {
		t.Fatal("return within grace did not resume")
	}
}

func TestReconcileOnlyConfirmedMissingKernels(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	body := `{"battles":[]}`
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
	defer host.Close()
	s.serverOrigin = host.URL
	newMatch := &matchRecord{RoomCode: "NEW", CreatedAt: time.Now().Add(time.Hour), Participants: map[string]string{}}
	s.data.Matches["NEW"] = newMatch
	body = `{"unexpected":true}`
	if s.reconcileBattles(time.Now()) || m.Completed {
		t.Fatal("invalid response discarded a match")
	}
	body = `{"battles":[]}`
	if !s.reconcileBattles(time.Now()) || !m.Completed || m.Winner != "" || newMatch.Completed {
		t.Fatal("reconciliation is not race safe")
	}
	if s.data.Users["player"].Experience["pku"] != 0 {
		t.Fatal("server restart awarded XP")
	}
}

func TestActiveMatchBlocksHomepageMutations(t *testing.T) {
	_, mux, _, token := lifecycleFixture(t)
	for _, path := range []string{"/api/logout", "/api/cosmetic", "/api/lobby/ai", "/api/lobby/pvp"} {
		res := requestJSON(t, mux, "POST", path, map[string]string{"difficulty": "hard", "team": "pku", "item": "pku-gold"}, token)
		if res.Code != 409 {
			t.Fatalf("%s: %d %s", path, res.Code, res.Body.String())
		}
	}
}

func TestOpponentLifecycleAndPrivacy(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	m.Mode = "pvp"
	m.Participants["opponent"] = "thu"
	m.JoinedPlayers["player"] = true
	m.JoinDeadline = time.Now().Add(time.Minute)
	view := s.matchViewLocked("player", m)
	if view["phase"] != "waiting_players" {
		t.Fatal(view)
	}
	m.JoinedPlayers["opponent"] = true
	if s.matchViewLocked("player", m)["phase"] != "active" {
		t.Fatal("join not visible")
	}
	m.DisconnectedAt["opponent"] = time.Now()
	view = s.matchViewLocked("player", m)
	if view["phase"] != "reconnecting" {
		t.Fatal("disconnect not visible")
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "password") || strings.Contains(string(encoded), "connectionId") {
		t.Fatal("private fields leaked")
	}
	peers := view["participants"].([]map[string]any)
	if peers[0]["id"] != "opponent" || peers[0]["status"] != "disconnected" || peers[0]["deadline"].(int64) <= time.Now().UnixMilli() {
		t.Fatal(peers)
	}
	delete(m.DisconnectedAt, "opponent")
	if s.matchViewLocked("player", m)["phase"] != "active" {
		t.Fatal("reconnect not visible")
	}
}

func TestUnenteredBattleExpiresWithoutRewards(t *testing.T) {
	s, _, m, _ := lifecycleFixture(t)
	m.JoinDeadline = time.Now().Add(-time.Second)
	if !s.expireMatchLocked(m, time.Now()) || !m.Completed || m.Winner != "" {
		t.Fatal("unentered battle was not canceled")
	}
	if s.data.Users["player"].Experience["pku"] != 0 {
		t.Fatal("unentered battle awarded XP")
	}
}

func TestLifecycleSSEPublishesOpponentExitPromptly(t *testing.T) {
	s, mux, m, token := lifecycleFixture(t)
	m.Mode = "pvp"
	m.Participants["opponent"] = "thu"
	m.JoinedPlayers["opponent"] = true
	host := httptest.NewServer(mux)
	defer host.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", host.URL+"/api/match/presence?room="+m.RoomCode+"&connectionId=test-life", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := host.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	reader := bufio.NewReader(res.Body)
	if _, err = reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	m.DisconnectedAt["opponent"] = time.Now()
	s.mu.Unlock()
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal("no prompt opponent notification", err)
		}
		if strings.Contains(line, `"status":"disconnected"`) {
			break
		}
	}
}
