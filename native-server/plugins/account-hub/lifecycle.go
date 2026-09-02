package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

func (s *hubServer) rejectActiveLocked(w http.ResponseWriter, id string) bool {
	if m := s.activeMatchForUserLocked(id); m != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "请先完成正在进行的战斗", "activeMatch": s.matchViewLocked(id, m)})
		return true
	}
	return false
}

func (s *hubServer) reserveCreationLocked(w http.ResponseWriter, id string) bool {
	if s.creating == nil {
		s.creating = map[string]bool{}
	}
	if s.creating[id] {
		writeError(w, http.StatusConflict, "战局正在创建，请稍候")
		return false
	}
	s.creating[id] = true
	return true
}

func (s *hubServer) releaseCreation(id string) {
	s.mu.Lock()
	delete(s.creating, id)
	s.mu.Unlock()
}

func (s *hubServer) interruptMatchLocked(m *matchRecord, reason string) {
	m.Completed, m.CompletedAt, m.ResultReason = true, time.Now(), reason
	m.Winner = ""
	for id := range m.Participants {
		delete(s.ready, id)
	}
	_ = s.saveLocked()
}

// Called under mu, including BEFORE accepting a reconnection at the deadline.
func (s *hubServer) expireMatchLocked(m *matchRecord, now time.Time) bool {
	if m.Completed {
		return false
	}
	ensureMatchMaps(m)
	for id, last := range m.LastHeartbeat {
		// SSE delivery must be acknowledged by the page. This catches a severed
		// network even while the OS still buffers writes to an apparently open TCP socket.
		if m.Connections[id] != "" && !last.IsZero() && now.Sub(last) > 30*time.Second && m.DisconnectedAt[id].IsZero() {
			m.DisconnectedAt[id] = last.Add(10 * time.Second)
		}
	}
	expired := []string{}
	for id, disconnected := range m.DisconnectedAt {
		if m.SeenPlayers[id] && !disconnected.IsZero() && now.Sub(disconnected) >= time.Minute {
			expired = append(expired, id)
		}
	}
	if len(expired) == 0 {
		return false
	}
	if len(expired) == len(m.Participants) && len(expired) > 1 {
		s.interruptMatchLocked(m, "双方均断线超过60秒，本局作废，不计经验")
	} else {
		s.completeMatchLocked(m, oppositeTeam(m.Participants[expired[0]]), expired[0]+" 断线超过60秒")
	}
	s.scheduleBattleDeletion(m.RoomCode, 20*time.Second)
	return true
}

// Only a successful, fully decoded server response can invalidate a saved match.
// A failed probe is not evidence of a lost match. New matches created during the
// request are excluded to avoid racing creation with reconciliation.
func (s *hubServer) reconcileBattles(started time.Time) bool {
	req, err := http.NewRequest(http.MethodGet, s.serverOrigin+"/api/internal/battles", nil)
	if err != nil {
		return false
	}
	req.Header.Set("X-Qingbei-Plugin-Secret", s.pluginSecret)
	res, err := s.client.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var result struct {
		Battles *[]struct {
			RoomCode string `json:"roomCode"`
		} `json:"battles"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(res.Body).Decode(&result) != nil || result.Battles == nil {
		return false
	}
	live := map[string]bool{}
	for _, b := range *result.Battles {
		live[normalizeRoom(b.RoomCode)] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range s.data.Matches {
		if !m.Completed && m.CreatedAt.Before(started) && !live[m.RoomCode] {
			s.interruptMatchLocked(m, "服务器重启或战局已停止，本局中断，不计胜负和经验")
		}
	}
	return true
}

func (s *hubServer) matchPresence(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	connection := r.URL.Query().Get("connectionId")
	if len(connection) < 8 || len(connection) > 80 {
		writeError(w, http.StatusBadRequest, "连接标识无效")
		return
	}
	s.mu.Lock()
	u, m, ok := s.authenticatedMatch(w, r, r.URL.Query().Get("room"))
	if !ok {
		s.mu.Unlock()
		return
	}
	s.expireMatchLocked(m, time.Now())
	if s.presence == nil {
		s.presence = map[string]string{}
	}
	key := m.RoomCode + "/" + u.ID
	// A separate stream generation prevents a closing old request from marking
	// a newly reconnected EventSource (same page id) as disconnected.
	generation := randomToken(12)
	if !m.Completed {
		s.presence[key] = generation
		m.Connections[u.ID] = connection
		m.SeenPlayers[u.ID] = true
		m.LastHeartbeat[u.ID] = time.Now()
		delete(m.DisconnectedAt, u.ID)
		_ = s.saveLocked()
	}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.presence[key] == generation {
			delete(s.presence, key)
			if !m.Completed && m.DisconnectedAt[u.ID].IsZero() {
				m.DisconnectedAt[u.ID] = time.Now()
				_ = s.saveLocked()
			}
		}
	}()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		s.mu.Lock()
		superseded := !m.Completed && s.presence[key] != generation
		view := s.matchViewLocked(u.ID, m)
		done := m.Completed
		s.mu.Unlock()
		if superseded {
			_, _ = fmt.Fprint(w, "event: replaced\ndata: {}\n\n")
			_ = controller.Flush()
			return
		}
		encoded, _ := json.Marshal(view)
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprintf(w, "data: %s\n\n", encoded); err != nil {
			return
		}
		if err := controller.Flush(); err != nil || done {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
