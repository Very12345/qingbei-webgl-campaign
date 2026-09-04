package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type battleStats struct {
	Version      int            `json:"version"`
	ElapsedHours float64        `json:"elapsedHours"`
	Kills        map[string]int `json:"kills"`
	Captures     map[string]int `json:"captures"`
}

type matchReward struct {
	Kills        int               `json:"kills"`
	Captures     int               `json:"captures"`
	VictoryBonus int               `json:"victoryBonus"`
	Multiplier   float64           `json:"multiplier"`
	Experience   int               `json:"experience"`
	Coins        int               `json:"coins"`
	Progression  *matchProgression `json:"progression,omitempty"`
}

type levelProgress struct {
	Level int   `json:"level"`
	Start int64 `json:"start"`
	Next  int64 `json:"next"`
}
type matchProgression struct {
	Before int             `json:"before"`
	After  int             `json:"after"`
	Levels []levelProgress `json:"levels"`
}

func rewardProgression(before, after int) *matchProgression {
	p := &matchProgression{Before: before, After: after}
	first, last := levelFor(before), levelFor(after)
	for level := first; level <= last; level++ {
		// Bound very large settlements, keeping both endpoint levels authoritative.
		if level > first+8 && level < last {
			continue
		}
		next := experienceForLevel(level + 1)
		if level == careerLevelLimit {
			next = experienceForLevel(level)
		}
		p.Levels = append(p.Levels, levelProgress{level, experienceForLevel(level), next})
	}
	return p
}

func scoreReward(stats *battleStats, team, winner, pace string) matchReward {
	r := matchReward{Multiplier: 1}
	if stats == nil || stats.Version != 1 {
		return r
	}
	r.Kills, r.Captures = max(0, stats.Kills[team]), max(0, stats.Captures[team])
	// No participation stipend; even the winner must have contributed.
	if team == winner && r.Kills+r.Captures > 0 {
		r.VictoryBonus = 100
	}
	if pace == "blitz" {
		r.Multiplier = .5
	}
	r.Experience = int(float64(r.Kills+r.Captures+r.VictoryBonus) * r.Multiplier)
	r.Coins = r.Experience / 5
	return r
}

func (s *hubServer) fetchBattleStats(room string) (*battleStats, error) {
	request, _ := http.NewRequest(http.MethodGet, s.serverOrigin+"/api/internal/battles/"+url.PathEscape(room)+"/stats", nil)
	request.Header.Set("X-Qingbei-Plugin-Secret", s.pluginSecret)
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var stats battleStats
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&stats) != nil || stats.Version != 1 || stats.Kills == nil || stats.Captures == nil {
		return nil, fmt.Errorf("authoritative statistics unavailable")
	}
	return &stats, nil
}

func cloneAccount(u *userRecord) userRecord {
	data, _ := json.Marshal(u)
	var copy userRecord
	_ = json.Unmarshal(data, &copy)
	return copy
}

var speedCardPrices = map[string]int{"2x": 100, "4x": 250}

type purchaseReceipt struct {
	ID        string    `json:"id"`
	Team      string    `json:"team"`
	Item      string    `json:"item"`
	Quantity  int       `json:"quantity"`
	Cost      int       `json:"cost"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *hubServer) buySpeedCard(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       string `json:"purchaseId"`
		Team     string `json:"team"`
		Item     string `json:"item"`
		Quantity int    `json:"quantity"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	price := speedCardPrices[input.Item]
	if (input.Team != "pku" && input.Team != "thu") || price == 0 || input.Quantity < 1 || input.Quantity > 20 || len(input.ID) < 16 || len(input.ID) > 80 {
		writeError(w, http.StatusBadRequest, "购买参数无效")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user := s.userForTokenLocked(s.token(r))
	if user == nil {
		writeError(w, http.StatusUnauthorized, "尚未登录")
		return
	}
	if receipt, ok := user.Purchases[input.ID]; ok {
		if receipt.Team != input.Team || receipt.Item != input.Item || receipt.Quantity != input.Quantity {
			writeError(w, http.StatusConflict, "购买编号已用于另一笔交易")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"profile": s.publicProfileLocked(user), "receipt": receipt, "duplicate": true})
		return
	}
	if s.rejectActiveLocked(w, user.ID) {
		return
	}
	cost := price * input.Quantity
	if user.SchoolCoins[input.Team] < cost {
		writeError(w, http.StatusConflict, "该学校的校币不足")
		return
	}
	before := cloneAccount(user)
	if user.SpeedCards == nil {
		user.SpeedCards = map[string]int{}
	}
	if user.Purchases == nil {
		user.Purchases = map[string]purchaseReceipt{}
	}
	user.SchoolCoins[input.Team] -= cost
	user.SpeedCards[input.Item] += input.Quantity
	receipt := purchaseReceipt{ID: input.ID, Team: input.Team, Item: input.Item, Quantity: input.Quantity, Cost: cost, CreatedAt: time.Now()}
	user.Purchases[input.ID] = receipt
	if err := s.saveLocked(); err != nil {
		*user = before
		writeError(w, http.StatusServiceUnavailable, "购买未保存，余额未扣除，请重试")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": s.publicProfileLocked(user), "receipt": receipt})
}
