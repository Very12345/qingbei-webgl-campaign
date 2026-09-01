package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestHub(t *testing.T) (*hubServer, *http.ServeMux) {
	t.Helper()
	server := &hubServer{
		pluginID: "account-hub", pluginSecret: "test-secret",
		serverOrigin: "http://127.0.0.1:1", dataFile: filepath.Join(t.TempDir(), "accounts.json"),
		data:     persistedData{Users: map[string]*userRecord{}, Matches: map[string]*matchRecord{}},
		sessions: map[string]sessionRecord{}, ready: map[string]map[string]string{},
		loginAttempts: map[string]loginAttempt{},
		client:        &http.Client{Timeout: time.Second},
	}
	mux := http.NewServeMux()
	server.routes(mux)
	return server, mux
}

func requestJSON(t *testing.T, mux http.Handler, method, path string, payload any, token string) *httptest.ResponseRecorder {
	t.Helper()
	encoded, _ := json.Marshal(payload)
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func TestRegisterProfileAndAuthorizedJoin(t *testing.T) {
	server, mux := newTestHub(t)
	registration := requestJSON(t, mux, http.MethodPost, "/api/register", map[string]string{"id": "Player_01", "password": "secret12"}, "")
	if registration.Code != http.StatusCreated {
		t.Fatalf("register returned %d: %s", registration.Code, registration.Body.String())
	}
	cookies := registration.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Value == "" {
		t.Fatal("registration did not issue a session token")
	}
	token := cookies[0].Value
	if bytes.Contains(registration.Body.Bytes(), []byte(token)) {
		t.Fatal("HttpOnly session token leaked into the JSON response")
	}
	profile := requestJSON(t, mux, http.MethodGet, "/api/me", nil, token)
	if profile.Code != http.StatusOK {
		t.Fatalf("profile returned %d", profile.Code)
	}
	server.mu.Lock()
	server.data.Matches["ROOM12345"] = &matchRecord{RoomCode: "ROOM12345", Mode: "ai", Difficulty: "hard", Participants: map[string]string{"player_01": "pku"}}
	server.mu.Unlock()
	request := httptest.NewRequest(http.MethodPost, "/hooks/player/join", bytes.NewReader([]byte(`{"token":"`+token+`","roomCode":"ROOM12345","team":"pku","peerId":"peer"}`)))
	request.Header.Set("X-Qingbei-Plugin-Secret", "test-secret")
	authorized := httptest.NewRecorder()
	mux.ServeHTTP(authorized, request)
	if authorized.Code != http.StatusOK || !bytes.Contains(authorized.Body.Bytes(), []byte(`"allow":true`)) {
		t.Fatalf("join hook failed: %d %s", authorized.Code, authorized.Body.String())
	}
}

func TestRewardsAreAppliedOnce(t *testing.T) {
	server, mux := newTestHub(t)
	server.data.Users["winner"] = &userRecord{ID: "winner", Experience: map[string]int{"pku": 0, "thu": 0}, SpeedCards: map[string]int{}, SelectedCosmetics: map[string]string{}}
	server.data.Matches["MATCH1234"] = &matchRecord{RoomCode: "MATCH1234", Mode: "pvp", Participants: map[string]string{"winner": "pku"}}
	payload := []byte(`{"roomCode":"MATCH1234","winner":"pku","mode":"pvp"}`)
	for index := 0; index < 2; index++ {
		request := httptest.NewRequest(http.MethodPost, "/hooks/battle/result", bytes.NewReader(payload))
		request.Header.Set("X-Qingbei-Plugin-Secret", "test-secret")
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("result hook returned %d", response.Code)
		}
	}
	if server.data.Users["winner"].Experience["pku"] != 120 {
		t.Fatalf("result must be idempotent, got %d XP", server.data.Users["winner"].Experience["pku"])
	}
}

func TestSecureProxySessionAndJoinURL(t *testing.T) {
	_, mux := newTestHub(t)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/register",
		bytes.NewReader([]byte(`{"id":"secure_proxy","password":"long-password-1"}`)),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	cookies := response.Result().Cookies()
	if len(cookies) == 0 || !cookies[0].Secure || !cookies[0].HttpOnly {
		t.Fatal("proxied HTTPS login must issue a Secure HttpOnly cookie")
	}
	server, _ := newTestHub(t)
	joinURL := server.joinURL("ROOM12345", "pku")
	if strings.Contains(joinURL, "token") || strings.Contains(joinURL, "qingbei_hub") {
		t.Fatalf("join URL leaked authentication data: %s", joinURL)
	}
}
