package main

import (
	"net/http"
	"time"
)

// The same lock decides both queue cancellation and reservation by a partner.
// Once reserved, cancellation must not abandon the other player's new battle.
func (s *hubServer) cancelPVPQueue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "请使用 POST")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user := s.userForTokenLocked(s.token(r))
	if user == nil {
		writeError(w, http.StatusUnauthorized, "尚未登录")
		return
	}
	if match := s.activeMatchForUserLocked(user.ID); match != nil {
		writeJSON(w, http.StatusOK, s.matchViewLocked(user.ID, match))
		return
	}
	if ready := s.ready[user.ID]; ready != nil {
		writeJSON(w, http.StatusOK, ready)
		return
	}
	if s.creating[user.ID] {
		writeError(w, http.StatusConflict, "已匹配到玩家，正在创建战局，请稍候")
		return
	}
	s.clearUserQueuesLocked(user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"queued": false, "cancelled": true})
}

func (s *hubServer) queueStatusLocked(id string) map[string]any {
	for pace, queue := range map[string]**queueEntry{"standard": &s.waiting, "blitz": &s.waitingBlitz} {
		if *queue == nil || (*queue).UserID != id {
			continue
		}
		elapsed := time.Since((*queue).JoinedAt)
		if elapsed > 10*time.Minute {
			*queue = nil
			break
		}
		return map[string]any{"queued": true, "pace": pace, "waitedSeconds": int(elapsed.Seconds())}
	}
	return map[string]any{"queued": false, "creating": s.creating[id]}
}

func (s *hubServer) queueFor(pace string) **queueEntry {
	if pace == "blitz" {
		return &s.waitingBlitz
	}
	return &s.waiting
}

func (s *hubServer) clearUserQueuesLocked(id string) {
	for _, queue := range []**queueEntry{&s.waiting, &s.waitingBlitz} {
		if *queue != nil && (*queue).UserID == id {
			*queue = nil
		}
	}
}
