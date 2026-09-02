package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed static/*
var staticFiles embed.FS

const pluginVersion = "0.3.3"

type userRecord struct {
	ID                string            `json:"id"`
	Salt              string            `json:"salt"`
	PasswordHash      string            `json:"passwordHash"`
	PasswordScheme    string            `json:"passwordScheme,omitempty"`
	Experience        map[string]int    `json:"experience"`
	SpeedCards        map[string]int    `json:"speedCards"`
	Cosmetics         []string          `json:"cosmetics"`
	SelectedCosmetics map[string]string `json:"selectedCosmetics"`
	CreatedAt         time.Time         `json:"createdAt"`
}

type matchRecord struct {
	RoomCode       string               `json:"roomCode"`
	Mode           string               `json:"mode"`
	Difficulty     string               `json:"difficulty,omitempty"`
	Participants   map[string]string    `json:"participants"`
	Completed      bool                 `json:"completed"`
	Winner         string               `json:"winner,omitempty"`
	ResultReason   string               `json:"resultReason,omitempty"`
	CreatedAt      time.Time            `json:"createdAt"`
	CompletedAt    time.Time            `json:"completedAt,omitempty"`
	SeenPlayers    map[string]bool      `json:"seenPlayers,omitempty"`
	LastHeartbeat  map[string]time.Time `json:"lastHeartbeat,omitempty"`
	DisconnectedAt map[string]time.Time `json:"disconnectedAt,omitempty"`
	Connections    map[string]string    `json:"connections,omitempty"`
}

type persistedData struct {
	Users   map[string]*userRecord  `json:"users"`
	Matches map[string]*matchRecord `json:"matches"`
}

type sessionRecord struct {
	UserID    string
	ExpiresAt time.Time
}

type loginAttempt struct {
	Count   int
	ResetAt time.Time
}

type queueEntry struct {
	UserID    string
	Preferred string
	JoinedAt  time.Time
}

type hubServer struct {
	mu            sync.Mutex
	pluginID      string
	pluginSecret  string
	serverOrigin  string
	dataFile      string
	data          persistedData
	sessions      map[string]sessionRecord
	loginAttempts map[string]loginAttempt
	waiting       *queueEntry
	ready         map[string]map[string]string
	client        *http.Client
	creating      map[string]bool
	presence      map[string]string
}

func main() {
	port := envOr("QINGBEI_PLUGIN_PORT", "17910")
	dataFile := envOr("QINGBEI_ACCOUNT_DATA", "qingbei-account-hub.json")
	server := &hubServer{
		pluginID:      envOr("QINGBEI_PLUGIN_ID", "account-hub"),
		pluginSecret:  os.Getenv("QINGBEI_PLUGIN_SECRET"),
		serverOrigin:  strings.TrimRight(envOr("QINGBEI_SERVER_ORIGIN", "http://127.0.0.1:17890"), "/"),
		dataFile:      dataFile,
		data:          persistedData{Users: map[string]*userRecord{}, Matches: map[string]*matchRecord{}},
		sessions:      map[string]sessionRecord{},
		loginAttempts: map[string]loginAttempt{},
		ready:         map[string]map[string]string{},
		client:        &http.Client{Timeout: 8 * time.Second},
	}
	if err := server.load(); err != nil {
		log.Fatalf("读取账号数据失败: %v", err)
	}
	go server.runMatchJanitor()
	mux := http.NewServeMux()
	server.routes(mux)
	log.Printf("账号与匹配大厅插件监听 127.0.0.1:%s\n", port)
	if err := http.ListenAndServe("127.0.0.1:"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func (server *hubServer) routes(mux *http.ServeMux) {
	mux.HandleFunc("/health", func(writer http.ResponseWriter, request *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "plugin": server.pluginID, "version": pluginVersion})
	})
	mux.HandleFunc("/assets/", server.asset)
	mux.HandleFunc("/api/register", server.register)
	mux.HandleFunc("/api/login", server.login)
	mux.HandleFunc("/api/logout", server.logout)
	mux.HandleFunc("/api/me", server.me)
	mux.HandleFunc("/api/cosmetic", server.selectCosmetic)
	mux.HandleFunc("/api/lobby/ai", server.createAILobby)
	mux.HandleFunc("/api/lobby/pvp", server.joinPVPQueue)
	mux.HandleFunc("/api/lobby/status", server.lobbyStatus)
	mux.HandleFunc("/api/match/status", server.matchStatus)
	mux.HandleFunc("/api/match/heartbeat", server.matchHeartbeat)
	mux.HandleFunc("/api/match/disconnect", server.matchDisconnect)
	mux.HandleFunc("/api/match/surrender", server.matchSurrender)
	mux.HandleFunc("/api/match/presence", server.matchPresence)
	mux.HandleFunc("/protocol.js", func(w http.ResponseWriter, r *http.Request) {
		data, _ := staticFiles.ReadFile("static/protocol.js")
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(data)
	})
	mux.HandleFunc("/hooks/player/join", server.playerJoinHook)
	mux.HandleFunc("/hooks/battle/result", server.battleResultHook)
	mux.HandleFunc("/play/", server.servePlay)
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/" {
			http.NotFound(writer, request)
			return
		}
		data, _ := staticFiles.ReadFile("static/index.html")
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Header().Set("Cache-Control", "no-cache")
		writer.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("X-Frame-Options", "DENY")
		writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		_, _ = writer.Write(data)
	})
}

func securePageHeaders(writer http.ResponseWriter, allowCDN bool) {
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-cache")
	contentSecurityPolicy := "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
	if allowCDN {
		contentSecurityPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://very12345.github.io; style-src 'self' 'unsafe-inline' https://very12345.github.io; img-src 'self' data: blob: https://very12345.github.io; connect-src 'self' ws: wss: https://very12345.github.io; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
	}
	writer.Header().Set("Content-Security-Policy", contentSecurityPolicy)
	writer.Header().Set("Referrer-Policy", "no-referrer")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("X-Frame-Options", "DENY")
	writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
}

func (server *hubServer) servePlay(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/play/" {
		http.NotFound(writer, request)
		return
	}
	data, _ := staticFiles.ReadFile("static/play.html")
	securePageHeaders(writer, true)
	_, _ = writer.Write(data)
}

func (server *hubServer) asset(writer http.ResponseWriter, request *http.Request) {
	name := strings.TrimPrefix(request.URL.Path, "/assets/")
	allowed := map[string][2]string{
		"pku-bronze.svg": {"#d44b5d", "北"},
		"pku-gold.svg":   {"#f0bf45", "北"},
		"thu-bronze.svg": {"#9d63c2", "清"},
		"thu-gold.svg":   {"#e2adff", "清"},
	}
	definition, ok := allowed[name]
	if !ok {
		http.NotFound(writer, request)
		return
	}
	writer.Header().Set("Content-Type", "image/svg+xml")
	writer.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = fmt.Fprintf(writer, `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0d1715"/><circle cx="256" cy="256" r="205" fill="%s" stroke="#fff2bd" stroke-width="24"/><text x="256" y="300" text-anchor="middle" font-family="sans-serif" font-size="210" font-weight="900" fill="#fff7d8">%s</text></svg>`, definition[0], definition[1])
}

func (server *hubServer) register(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		ID       string `json:"id"`
		Password string `json:"password"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	id := normalizeUserID(input.ID)
	if len(id) < 3 || len(id) > 24 || len(input.Password) < 8 || len(input.Password) > 72 {
		writeError(writer, http.StatusBadRequest, "ID需为3—24位字母、数字、下划线；密码至少8位")
		return
	}
	salt := randomToken(16)
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.data.Users[id] != nil {
		writeError(writer, http.StatusConflict, "这个ID已经注册")
		return
	}
	server.data.Users[id] = &userRecord{ID: id, Salt: salt, PasswordHash: passwordHash(input.Password, salt), PasswordScheme: "pbkdf2-sha256-v1", Experience: map[string]int{"pku": 0, "thu": 0}, SpeedCards: map[string]int{}, Cosmetics: []string{}, SelectedCosmetics: map[string]string{}, CreatedAt: time.Now()}
	if err := server.saveLocked(); err != nil {
		writeError(writer, http.StatusInternalServerError, "保存账号失败")
		return
	}
	token := server.newSessionLocked(id)
	server.writeSession(writer, request, token)
	writeJSON(writer, http.StatusCreated, map[string]any{"profile": server.publicProfileLocked(server.data.Users[id])})
}

func (server *hubServer) login(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		ID       string `json:"id"`
		Password string `json:"password"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	id := normalizeUserID(input.ID)
	server.mu.Lock()
	defer server.mu.Unlock()
	attempt := server.loginAttempts[id]
	if time.Now().After(attempt.ResetAt) {
		attempt = loginAttempt{ResetAt: time.Now().Add(10 * time.Minute)}
	}
	if attempt.Count >= 5 {
		writeError(writer, http.StatusTooManyRequests, "登录尝试过多，请十分钟后再试")
		return
	}
	user := server.data.Users[id]
	validPassword := false
	if user != nil {
		derived := passwordHash(input.Password, user.Salt)
		if user.PasswordScheme == "" {
			derived = legacyPasswordHash(input.Password, user.Salt)
		}
		validPassword = subtle.ConstantTimeCompare([]byte(user.PasswordHash), []byte(derived)) == 1
	}
	if !validPassword {
		attempt.Count++
		server.loginAttempts[id] = attempt
		writeError(writer, http.StatusUnauthorized, "ID或密码不正确")
		return
	}
	delete(server.loginAttempts, id)
	if user.PasswordScheme == "" {
		user.PasswordHash = passwordHash(input.Password, user.Salt)
		user.PasswordScheme = "pbkdf2-sha256-v1"
		_ = server.saveLocked()
	}
	token := server.newSessionLocked(id)
	server.writeSession(writer, request, token)
	writeJSON(writer, http.StatusOK, map[string]any{"profile": server.publicProfileLocked(user)})
}

func (server *hubServer) logout(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	token := server.token(request)
	server.mu.Lock()
	if user := server.userForTokenLocked(token); user != nil && server.rejectActiveLocked(writer, user.ID) {
		server.mu.Unlock()
		return
	}
	delete(server.sessions, token)
	server.mu.Unlock()
	http.SetCookie(writer, &http.Cookie{Name: "qingbei_hub", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
}

func (server *hubServer) me(writer http.ResponseWriter, request *http.Request) {
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(server.token(request))
	if user == nil {
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"profile": server.publicProfileLocked(user)})
}

func (server *hubServer) selectCosmetic(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Item string `json:"item"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(server.token(request))
	if user == nil {
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return
	}
	team := strings.Split(input.Item, "-")[0]
	if server.rejectActiveLocked(writer, user.ID) {
		return
	}
	if team != "pku" && team != "thu" {
		writeError(writer, http.StatusBadRequest, "饰品无效")
		return
	}
	if input.Item != "" && !contains(user.Cosmetics, input.Item) {
		writeError(writer, http.StatusForbidden, "尚未解锁这个饰品")
		return
	}
	user.SelectedCosmetics[team] = input.Item
	_ = server.saveLocked()
	writeJSON(writer, http.StatusOK, map[string]any{"profile": server.publicProfileLocked(user)})
}

func ensureMatchMaps(match *matchRecord) {
	if match.Connections == nil {
		match.Connections = map[string]string{}
	}
	if match.SeenPlayers == nil {
		match.SeenPlayers = map[string]bool{}
	}
	if match.LastHeartbeat == nil {
		match.LastHeartbeat = map[string]time.Time{}
	}
	if match.DisconnectedAt == nil {
		match.DisconnectedAt = map[string]time.Time{}
	}
}

func (server *hubServer) activeMatchForUserLocked(userID string) *matchRecord {
	for _, match := range server.data.Matches {
		if !match.Completed && match.Participants[userID] != "" {
			ensureMatchMaps(match)
			return match
		}
	}
	return nil
}

func (server *hubServer) matchViewLocked(userID string, match *matchRecord) map[string]any {
	if match == nil {
		return nil
	}
	team := match.Participants[userID]
	view := map[string]any{
		"roomCode":   match.RoomCode,
		"mode":       match.Mode,
		"difficulty": match.Difficulty,
		"team":       team,
		"completed":  match.Completed,
		"winner":     match.Winner,
		"reason":     match.ResultReason,
	}
	if !match.Completed && team != "" {
		view["joinUrl"] = server.joinURL(match.RoomCode, team)
	}
	if disconnectedAt := match.DisconnectedAt[userID]; !disconnectedAt.IsZero() {
		view["disconnectDeadline"] = disconnectedAt.Add(time.Minute).UnixMilli()
	}
	return view
}

func (server *hubServer) createAILobby(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		Difficulty string `json:"difficulty"`
		Team       string `json:"team"`
		Card       string `json:"card"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	if !contains([]string{"casual", "standard", "hard"}, input.Difficulty) || !contains([]string{"pku", "thu"}, input.Team) {
		writeError(writer, http.StatusBadRequest, "大厅配置无效")
		return
	}
	token := server.token(request)
	server.mu.Lock()
	user := server.userForTokenLocked(token)
	if user == nil {
		server.mu.Unlock()
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return
	}
	if active := server.activeMatchForUserLocked(user.ID); active != nil {
		view := server.matchViewLocked(user.ID, active)
		server.mu.Unlock()
		writeJSON(writer, http.StatusConflict, map[string]any{"error": "已有进行中的战斗", "activeMatch": view})
		return
	}
	if !server.reserveCreationLocked(writer, user.ID) {
		server.mu.Unlock()
		return
	}
	defer server.releaseCreation(user.ID)
	if server.waiting != nil && server.waiting.UserID == user.ID {
		server.waiting = nil
	}
	timeScale := 1
	if input.Card != "" {
		if user.SpeedCards[input.Card] < 1 {
			server.mu.Unlock()
			writeError(writer, http.StatusForbidden, "没有这张倍速卡")
			return
		}
		if input.Card == "2x" {
			timeScale = 2
		} else if input.Card == "4x" {
			timeScale = 4
		} else {
			server.mu.Unlock()
			writeError(writer, http.StatusBadRequest, "倍速卡无效")
			return
		}
		user.SpeedCards[input.Card]--
		_ = server.saveLocked()
	}
	userID := user.ID
	server.mu.Unlock()
	spec := map[string]any{"name": "人机挑战 · " + input.Difficulty, "mode": "ai", "difficulty": input.Difficulty, "difficultyByTeam": map[string]string{"pku": input.Difficulty, "thu": input.Difficulty}, "timeScale": timeScale, "maxPlayers": 2, "allowSameTeam": false, "authPlugin": server.pluginID, "metadata": map[string]any{"owner": userID, "playerTeam": input.Team}}
	room, err := server.createBattle(spec)
	if err != nil {
		server.refundCard(userID, input.Card)
		writeError(writer, http.StatusServiceUnavailable, err.Error())
		return
	}
	server.mu.Lock()
	server.data.Matches[room] = &matchRecord{RoomCode: room, Mode: "ai", Difficulty: input.Difficulty, Participants: map[string]string{userID: input.Team}, CreatedAt: time.Now()}
	_ = server.saveLocked()
	server.mu.Unlock()
	writeJSON(writer, http.StatusCreated, map[string]any{"roomCode": room, "joinUrl": server.joinURL(room, input.Team)})
}

func (server *hubServer) joinPVPQueue(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		PreferredTeam string `json:"preferredTeam"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	if !contains([]string{"pku", "thu", "any"}, input.PreferredTeam) {
		input.PreferredTeam = "any"
	}
	token := server.token(request)
	server.mu.Lock()
	user := server.userForTokenLocked(token)
	if user == nil {
		server.mu.Unlock()
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return
	}
	if active := server.activeMatchForUserLocked(user.ID); active != nil {
		view := server.matchViewLocked(user.ID, active)
		server.mu.Unlock()
		writeJSON(writer, http.StatusConflict, map[string]any{"error": "已有进行中的战斗", "activeMatch": view})
		return
	}
	if ready := server.ready[user.ID]; ready != nil {
		server.mu.Unlock()
		writeJSON(writer, http.StatusOK, ready)
		return
	}
	if server.creating[user.ID] {
		server.mu.Unlock()
		writeError(writer, http.StatusConflict, "战局正在创建，请稍候")
		return
	}
	if server.waiting == nil || server.waiting.UserID == user.ID || time.Since(server.waiting.JoinedAt) > 10*time.Minute {
		server.waiting = &queueEntry{UserID: user.ID, Preferred: input.PreferredTeam, JoinedAt: time.Now()}
		server.mu.Unlock()
		writeJSON(writer, http.StatusAccepted, map[string]any{"queued": true})
		return
	}
	first := server.waiting
	if server.creating[first.UserID] || server.activeMatchForUserLocked(first.UserID) != nil {
		server.waiting = &queueEntry{UserID: user.ID, Preferred: input.PreferredTeam, JoinedAt: time.Now()}
		server.mu.Unlock()
		writeJSON(writer, http.StatusAccepted, map[string]any{"queued": true})
		return
	}
	server.reserveCreationLocked(writer, user.ID)
	server.reserveCreationLocked(writer, first.UserID)
	defer server.releaseCreation(user.ID)
	defer server.releaseCreation(first.UserID)
	server.waiting = nil
	secondID := user.ID
	server.mu.Unlock()
	firstTeam := "pku"
	if first.Preferred == "thu" {
		firstTeam = "thu"
	}
	secondTeam := "thu"
	if firstTeam == "thu" {
		secondTeam = "pku"
	}
	room, err := server.createBattle(map[string]any{"name": "联机匹配", "mode": "pvp", "timeScale": 1, "maxPlayers": 2, "allowSameTeam": false, "authPlugin": server.pluginID})
	if err != nil {
		server.mu.Lock()
		server.waiting = first
		server.mu.Unlock()
		writeError(writer, http.StatusServiceUnavailable, err.Error())
		return
	}
	server.mu.Lock()
	server.data.Matches[room] = &matchRecord{RoomCode: room, Mode: "pvp", Participants: map[string]string{first.UserID: firstTeam, secondID: secondTeam}, CreatedAt: time.Now()}
	server.ready[first.UserID] = map[string]string{"roomCode": room, "joinUrl": server.joinURL(room, firstTeam)}
	server.ready[secondID] = map[string]string{"roomCode": room, "joinUrl": server.joinURL(room, secondTeam)}
	_ = server.saveLocked()
	response := server.ready[secondID]
	server.mu.Unlock()
	writeJSON(writer, http.StatusCreated, response)
}

func (server *hubServer) lobbyStatus(writer http.ResponseWriter, request *http.Request) {
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(server.token(request))
	if user == nil {
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return
	}
	if active := server.activeMatchForUserLocked(user.ID); active != nil {
		writeJSON(writer, http.StatusOK, server.matchViewLocked(user.ID, active))
		return
	}
	if ready := server.ready[user.ID]; ready != nil {
		writeJSON(writer, http.StatusOK, ready)
		return
	}
	queued := server.waiting != nil && server.waiting.UserID == user.ID
	writeJSON(writer, http.StatusOK, map[string]any{"queued": queued})
}

func (server *hubServer) matchForUserLocked(userID, roomCode string) *matchRecord {
	match := server.data.Matches[normalizeRoom(roomCode)]
	if match == nil || match.Participants[userID] == "" {
		return nil
	}
	ensureMatchMaps(match)
	return match
}

func (server *hubServer) authenticatedMatch(writer http.ResponseWriter, request *http.Request, roomCode string) (*userRecord, *matchRecord, bool) {
	user := server.userForTokenLocked(server.token(request))
	if user == nil {
		writeError(writer, http.StatusUnauthorized, "尚未登录")
		return nil, nil, false
	}
	match := server.matchForUserLocked(user.ID, roomCode)
	if match == nil {
		writeError(writer, http.StatusNotFound, "没有找到这个账号的战斗")
		return nil, nil, false
	}
	return user, match, true
}

func (server *hubServer) matchStatus(writer http.ResponseWriter, request *http.Request) {
	server.mu.Lock()
	defer server.mu.Unlock()
	user, match, ok := server.authenticatedMatch(writer, request, request.URL.Query().Get("room"))
	if !ok {
		return
	}
	writeJSON(writer, http.StatusOK, server.matchViewLocked(user.ID, match))
}

func (server *hubServer) matchHeartbeat(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		RoomCode     string `json:"roomCode"`
		ConnectionID string `json:"connectionId"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user, match, ok := server.authenticatedMatch(writer, request, input.RoomCode)
	if !ok {
		return
	}
	server.expireMatchLocked(match, time.Now())
	if match.Completed {
		writeJSON(writer, http.StatusOK, server.matchViewLocked(user.ID, match))
		return
	}
	ensureMatchMaps(match)
	if match.Connections[user.ID] != input.ConnectionID {
		writeError(writer, http.StatusConflict, "战斗已在另一个页面打开")
		return
	}
	match.SeenPlayers[user.ID] = true
	match.LastHeartbeat[user.ID] = time.Now()
	if _, disconnected := match.DisconnectedAt[user.ID]; disconnected {
		delete(match.DisconnectedAt, user.ID)
		_ = server.saveLocked()
	}
	writeJSON(writer, http.StatusOK, server.matchViewLocked(user.ID, match))
}

func (server *hubServer) matchDisconnect(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		RoomCode     string `json:"roomCode"`
		ConnectionID string `json:"connectionId"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user, match, ok := server.authenticatedMatch(writer, request, input.RoomCode)
	if !ok {
		return
	}
	if !match.Completed && input.ConnectionID == match.Connections[user.ID] {
		ensureMatchMaps(match)
		match.SeenPlayers[user.ID] = true
		if match.DisconnectedAt[user.ID].IsZero() {
			match.DisconnectedAt[user.ID] = time.Now()
		}
		_ = server.saveLocked()
	}
	writeJSON(writer, http.StatusOK, server.matchViewLocked(user.ID, match))
}

func oppositeTeam(team string) string {
	if team == "pku" {
		return "thu"
	}
	return "pku"
}

func (server *hubServer) completeMatchLocked(match *matchRecord, winner, reason string) bool {
	if match == nil || match.Completed || (winner != "pku" && winner != "thu") {
		return false
	}
	match.Completed = true
	match.Winner = winner
	match.ResultReason = reason
	match.CompletedAt = time.Now()
	for userID, team := range match.Participants {
		delete(server.ready, userID)
		user := server.data.Users[userID]
		if user == nil {
			continue
		}
		gain := 30
		if match.Mode == "pvp" {
			if team == winner {
				gain = 120
			} else {
				gain = 60
			}
		} else {
			switch match.Difficulty {
			case "standard":
				gain = 60
			case "hard":
				gain = 100
			}
			if team != winner {
				gain /= 2
			}
		}
		user.Experience[team] += gain
		server.applyRewards(user, team)
	}
	_ = server.saveLocked()
	return true
}

func (server *hubServer) scheduleBattleDeletion(roomCode string, delay time.Duration) {
	go func() {
		time.Sleep(delay)
		server.deleteBattle(roomCode)
	}()
}

func (server *hubServer) matchSurrender(writer http.ResponseWriter, request *http.Request) {
	var input struct {
		RoomCode string `json:"roomCode"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	user, match, ok := server.authenticatedMatch(writer, request, input.RoomCode)
	if !ok {
		server.mu.Unlock()
		return
	}
	winner := oppositeTeam(match.Participants[user.ID])
	completed := server.completeMatchLocked(match, winner, user.ID+" 投降")
	view := server.matchViewLocked(user.ID, match)
	server.mu.Unlock()
	if completed {
		server.scheduleBattleDeletion(match.RoomCode, 20*time.Second)
	}
	writeJSON(writer, http.StatusOK, view)
}

func (server *hubServer) runMatchJanitor() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for now := range ticker.C {
		// A missing kernel after a server restart is an interruption, never a loss.
		if !server.reconcileBattles(now) {
			continue
		}
		server.mu.Lock()
		server.expireDisconnectedMatchesLocked(now)
		server.mu.Unlock()
	}
}

func (server *hubServer) expireDisconnectedMatchesLocked(now time.Time) []string {
	completedRooms := []string{}
	for _, match := range server.data.Matches {
		if match.Completed {
			continue
		}
		ensureMatchMaps(match)
		if server.expireMatchLocked(match, now) {
			completedRooms = append(completedRooms, match.RoomCode)
		}
	}
	return completedRooms
}

func (server *hubServer) playerJoinHook(writer http.ResponseWriter, request *http.Request) {
	if !server.validHook(request) {
		writeError(writer, http.StatusForbidden, "forbidden")
		return
	}
	var input struct{ Token, RoomCode, Team, PeerID string }
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(input.Token)
	match := server.data.Matches[normalizeRoom(input.RoomCode)]
	if match != nil {
		server.expireMatchLocked(match, time.Now())
	}
	if user == nil || match == nil || match.Completed || match.Participants[user.ID] != input.Team {
		writeJSON(writer, http.StatusOK, map[string]any{"allow": false, "message": "账号不属于这个大厅或阵营"})
		return
	}
	ensureMatchMaps(match)
	match.SeenPlayers[user.ID] = true
	match.LastHeartbeat[user.ID] = time.Now()
	// A WebSocket alone must not cancel a plugin presence deadline.
	if match.Connections[user.ID] == "" {
		delete(match.DisconnectedAt, user.ID)
	}
	profile := server.publicProfileLocked(user)
	if item := user.SelectedCosmetics[input.Team]; item != "" && contains(user.Cosmetics, item) {
		profile["cosmetic"] = map[string]any{"team": input.Team, "url": "/plugins/" + server.pluginID + "/assets/" + item + ".svg"}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"allow": true, "accountId": user.ID, "profile": profile})
}

func (server *hubServer) battleResultHook(writer http.ResponseWriter, request *http.Request) {
	if !server.validHook(request) {
		writeError(writer, http.StatusForbidden, "forbidden")
		return
	}
	var input struct{ RoomCode, Winner, Mode, Difficulty string }
	if !decodeJSON(writer, request, &input) {
		return
	}
	server.mu.Lock()
	match := server.data.Matches[normalizeRoom(input.RoomCode)]
	if match == nil || match.Completed {
		server.mu.Unlock()
		writeJSON(writer, http.StatusOK, map[string]any{"ok": true, "duplicate": true})
		return
	}
	completed := server.completeMatchLocked(match, input.Winner, "战局胜负已确定")
	roomCode := match.RoomCode
	server.mu.Unlock()
	writeJSON(writer, http.StatusOK, map[string]any{"ok": true})
	if completed {
		server.scheduleBattleDeletion(roomCode, 10*time.Minute)
	}
}

func (server *hubServer) applyRewards(user *userRecord, team string) {
	level := levelFor(user.Experience[team])
	if level >= 2 && user.SpeedCards["2x"] < 1 {
		user.SpeedCards["2x"]++
	}
	bronze := team + "-bronze"
	if level >= 3 && !contains(user.Cosmetics, bronze) {
		user.Cosmetics = append(user.Cosmetics, bronze)
	}
	if level >= 4 && user.SpeedCards["4x"] < 1 {
		user.SpeedCards["4x"]++
	}
	gold := team + "-gold"
	if level >= 5 && !contains(user.Cosmetics, gold) {
		user.Cosmetics = append(user.Cosmetics, gold)
	}
}

func (server *hubServer) publicProfileLocked(user *userRecord) map[string]any {
	profile := map[string]any{"id": user.ID, "experience": user.Experience, "levels": map[string]int{"pku": levelFor(user.Experience["pku"]), "thu": levelFor(user.Experience["thu"])}, "speedCards": user.SpeedCards, "cosmetics": user.Cosmetics, "selectedCosmetics": user.SelectedCosmetics}
	if active := server.activeMatchForUserLocked(user.ID); active != nil {
		profile["activeMatch"] = server.matchViewLocked(user.ID, active)
	}
	return profile
}

func levelFor(experience int) int {
	thresholds := []int{0, 100, 250, 500, 900, 1400}
	for index := len(thresholds) - 1; index >= 0; index-- {
		if experience >= thresholds[index] {
			return index + 1
		}
	}
	return 1
}

func (server *hubServer) createBattle(spec any) (string, error) {
	encoded, _ := json.Marshal(spec)
	request, _ := http.NewRequest(http.MethodPost, server.serverOrigin+"/api/internal/battles", strings.NewReader(string(encoded)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Qingbei-Plugin-Secret", server.pluginSecret)
	response, err := server.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return "", errors.New(strings.TrimSpace(string(body)))
	}
	var result struct {
		RoomCode string `json:"roomCode"`
	}
	if json.NewDecoder(response.Body).Decode(&result) != nil || result.RoomCode == "" {
		return "", errors.New("服务器没有返回战局码")
	}
	return result.RoomCode, nil
}

func (server *hubServer) deleteBattle(room string) {
	request, _ := http.NewRequest(http.MethodDelete, server.serverOrigin+"/api/internal/battles/"+url.PathEscape(room), nil)
	request.Header.Set("X-Qingbei-Plugin-Secret", server.pluginSecret)
	response, err := server.client.Do(request)
	if err == nil {
		_ = response.Body.Close()
	}
}

func (server *hubServer) joinURL(room, team string) string {
	return "/plugins/" + url.PathEscape(server.pluginID) + "/play/?local=1&join=" + url.QueryEscape(room) + "&pluginTeam=" + url.QueryEscape(team)
}
func (server *hubServer) refundCard(userID, card string) {
	if card == "" {
		return
	}
	server.mu.Lock()
	if user := server.data.Users[userID]; user != nil {
		user.SpeedCards[card]++
		_ = server.saveLocked()
	}
	server.mu.Unlock()
}
func (server *hubServer) validHook(request *http.Request) bool {
	return server.pluginSecret != "" && request.Header.Get("X-Qingbei-Plugin-Secret") == server.pluginSecret
}
func (server *hubServer) token(request *http.Request) string {
	if value := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer "); value != "" {
		return value
	}
	if cookie, err := request.Cookie("qingbei_hub"); err == nil {
		return cookie.Value
	}
	return ""
}
func (server *hubServer) userForTokenLocked(token string) *userRecord {
	session, ok := server.sessions[token]
	if !ok || time.Now().After(session.ExpiresAt) {
		delete(server.sessions, token)
		return nil
	}
	return server.data.Users[session.UserID]
}
func (server *hubServer) newSessionLocked(userID string) string {
	token := randomToken(32)
	server.sessions[token] = sessionRecord{UserID: userID, ExpiresAt: time.Now().Add(30 * 24 * time.Hour)}
	return token
}
func (server *hubServer) writeSession(writer http.ResponseWriter, request *http.Request, token string) {
	secure := request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(writer, &http.Cookie{Name: "qingbei_hub", Value: token, Path: "/", MaxAge: 30 * 24 * 3600, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func (server *hubServer) load() error {
	data, err := os.ReadFile(server.dataFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, &server.data); err != nil {
		return err
	}
	if server.data.Users == nil {
		server.data.Users = map[string]*userRecord{}
	}
	if server.data.Matches == nil {
		server.data.Matches = map[string]*matchRecord{}
	}
	return nil
}
func (server *hubServer) saveLocked() error {
	if directory := filepath.Dir(server.dataFile); directory != "." {
		_ = os.MkdirAll(directory, 0700)
	}
	encoded, err := json.MarshalIndent(server.data, "", "  ")
	if err != nil {
		return err
	}
	temporary := server.dataFile + ".tmp"
	if err = os.WriteFile(temporary, encoded, 0600); err != nil {
		return err
	}
	return os.Rename(temporary, server.dataFile)
}
func legacyPasswordHash(password, salt string) string {
	value := []byte(salt + "\x00" + password)
	for index := 0; index < 120000; index++ {
		sum := sha256.Sum256(value)
		value = sum[:]
	}
	return hex.EncodeToString(value)
}

func passwordHash(password, salt string) string {
	const iterations = 210_000
	key := []byte(password)
	block := make([]byte, len(salt)+4)
	copy(block, []byte(salt))
	binary.BigEndian.PutUint32(block[len(salt):], 1)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(block)
	u := mac.Sum(nil)
	result := append([]byte(nil), u...)
	for index := 1; index < iterations; index++ {
		mac.Reset()
		_, _ = mac.Write(u)
		u = mac.Sum(nil)
		for offset := range result {
			result[offset] ^= u[offset]
		}
	}
	return hex.EncodeToString(result)
}
func randomToken(size int) string {
	data := make([]byte, size)
	_, _ = rand.Read(data)
	return hex.EncodeToString(data)
}
func normalizeUserID(value string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_' {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}
func normalizeRoom(value string) string { return strings.ToUpper(strings.TrimSpace(value)) }
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func decodeJSON(writer http.ResponseWriter, request *http.Request, target any) bool {
	if request.Method != http.MethodPost {
		writer.WriteHeader(http.StatusMethodNotAllowed)
		return false
	}
	if json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10)).Decode(target) != nil {
		writeError(writer, http.StatusBadRequest, "请求格式不正确")
		return false
	}
	return true
}
func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]any{"error": message})
}
func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
