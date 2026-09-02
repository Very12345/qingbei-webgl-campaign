package main

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
)

const careerLevelLimit = 10_000
const careerPageSize = 50

func experienceForLevel(level int) int64 {
	if level <= 1 {
		return 0
	}
	if level <= 6 {
		return []int64{0, 100, 250, 500, 900, 1400}[level-1]
	}
	// From level 6 onward, L -> L+1 costs 100*L XP. Cumulative XP is quadratic.
	l := int64(level)
	return 50*l*(l-1) - 100
}

// Career views are projections of authoritative account and settled match data.
// Opening a profile must never grant experience or invent match results.
type careerStats struct {
	Battles      int `json:"battles"`
	Wins         int `json:"wins"`
	TrainingWins int `json:"trainingWins"`
	PVPWins      int `json:"pvpWins"`
	HardWins     int `json:"hardWins"`
}

type careerAchievement struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Current     int    `json:"current"`
	Target      int    `json:"target"`
	Unlocked    bool   `json:"unlocked"`
	Medal       string `json:"medal"`
}

type careerReward struct {
	Level      int     `json:"level"`
	Experience int64   `json:"experience"`
	Name       string  `json:"name"`
	Kind       string  `json:"kind"`
	Item       string  `json:"item,omitempty"`
	Progress   float64 `json:"progress"`
	Reached    bool    `json:"reached"`
	Claimed    bool    `json:"claimed"`
	Claimable  bool    `json:"claimable"`
	Automatic  bool    `json:"automatic"`
}

type teamCareer struct {
	Team           string              `json:"team"`
	Level          int                 `json:"level"`
	Experience     int                 `json:"experience"`
	LevelStart     int64               `json:"levelStart"`
	NextExperience int64               `json:"nextExperience"`
	MaxLevel       int                 `json:"maxLevel"`
	PageStart      int                 `json:"pageStart"`
	NextReward     *careerReward       `json:"nextReward,omitempty"`
	Stats          careerStats         `json:"stats"`
	Achievements   []careerAchievement `json:"achievements"`
	Rewards        []careerReward      `json:"rewards"`
}

func careerAchievements(stats careerStats) []careerAchievement {
	items := []careerAchievement{
		{ID: "first-battle", Title: "初上前线", Description: "完成 1 场战斗", Current: stats.Battles, Target: 1, Medal: "cross"},
		{ID: "training", Title: "训练有成", Description: "赢得 3 场人机训练", Current: stats.TrainingWins, Target: 3, Medal: "shield"},
		{ID: "pvp-five", Title: "初露锋芒", Description: "赢得 5 场联机对战", Current: stats.PVPWins, Target: 5, Medal: "bronze"},
		{ID: "pvp-fifty", Title: "前线老兵", Description: "赢得 50 场联机对战", Current: stats.PVPWins, Target: 50, Medal: "silver"},
		{ID: "hard-training", Title: "迎难而上", Description: "赢得 3 场困难训练", Current: stats.HardWins, Target: 3, Medal: "star"},
		{ID: "veteran", Title: "久经战阵", Description: "完成 25 场战斗", Current: stats.Battles, Target: 25, Medal: "gold"},
	}
	for i := range items {
		items[i].Unlocked = items[i].Current >= items[i].Target
	}
	return items
}

func (server *hubServer) careerForUserLocked(user *userRecord) map[string]teamCareer {
	result := make(map[string]teamCareer, 2)
	for _, team := range []string{"pku", "thu"} {
		xp := user.Experience[team]
		career := teamCareer{Team: team, Level: levelFor(xp), Experience: xp, MaxLevel: careerLevelLimit}
		career.LevelStart = experienceForLevel(career.Level)
		if career.Level < careerLevelLimit {
			career.NextExperience = experienceForLevel(career.Level + 1)
			next := rewardDefinition(team, career.Level+1)
			career.NextReward = &next
		}
		for _, match := range server.data.Matches {
			if match == nil || !match.Completed || (match.Winner != "pku" && match.Winner != "thu") || match.Participants[user.ID] != team {
				continue
			}
			career.Stats.Battles++
			if match.Winner != team {
				continue
			}
			career.Stats.Wins++
			if match.Mode == "pvp" {
				career.Stats.PVPWins++
			} else if match.Mode == "ai" {
				career.Stats.TrainingWins++
				if match.Difficulty == "hard" {
					career.Stats.HardWins++
				}
			}
		}
		career.Achievements = careerAchievements(career.Stats)
		career.PageStart = (career.Level-1)/careerPageSize*careerPageSize + 1
		career.Rewards = rewardsForPage(user, team, career.PageStart)
		result[team] = career
	}
	return result
}

func rewardDefinition(team string, level int) careerReward {
	r := careerReward{Level: level, Experience: experienceForLevel(level), Name: "2× 倍速卡 ×1", Kind: "speed", Item: "2x"}
	switch level {
	case 1:
		r.Name, r.Kind, r.Item = "加入阵营", "rank", ""
	case 2: // Retain the existing starter rewards.
	case 3:
		r.Name, r.Kind, r.Item = "铜色阵营饰品", "cosmetic", team+"-bronze"
	case 4:
		r.Name, r.Item = "4× 倍速卡 ×1", "4x"
	case 5:
		r.Name, r.Kind, r.Item = "金色阵营饰品", "cosmetic", team+"-gold"
	case 6:
		r.Name, r.Kind, r.Item = "初阶指挥结业", "rank", ""
	default:
		switch {
		case level%25 == 0:
			r.Kind, r.Item = "cosmetic", fmt.Sprintf("%s-service-%d", team, level)
			r.Name = serviceCosmeticName(level)
		case level%10 == 0:
			r.Name, r.Kind, r.Item = "补给箱 · 2×两张 / 4×一张", "bundle", "supplies"
		case level%5 == 0:
			r.Name, r.Item = "4× 倍速卡 ×1", "4x"
		}
	}
	return r
}

func rewardsForPage(user *userRecord, team string, start int) []careerReward {
	items := make([]careerReward, 0, careerPageSize)
	xp := int64(user.Experience[team])
	for level := start; level < start+careerPageSize && level <= careerLevelLimit; level++ {
		r := rewardDefinition(team, level)
		r.Reached, r.Automatic = xp >= r.Experience, level <= 6
		r.Claimed = user.ClaimedRewards[fmt.Sprintf("%s:%d", team, level)]
		r.Claimable = r.Reached && !r.Automatic && !r.Claimed
		if r.Reached {
			r.Progress = 1
		} else if from := experienceForLevel(level - 1); xp > from {
			r.Progress = float64(xp-from) / float64(r.Experience-from)
		}
		items = append(items, r)
	}
	return items
}

func (server *hubServer) careerPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	team := r.URL.Query().Get("team")
	start, err := strconv.Atoi(r.URL.Query().Get("start"))
	if (team != "pku" && team != "thu") || err != nil || start < 1 || start > careerLevelLimit || (start-1)%careerPageSize != 0 {
		writeError(w, http.StatusBadRequest, "阵营或等级分页无效")
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(server.token(r))
	if user == nil {
		writeError(w, http.StatusUnauthorized, "尚未登录")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"team": team, "start": start, "maxLevel": careerLevelLimit, "rewards": rewardsForPage(user, team, start)})
}

func (server *hubServer) claimCareerReward(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var input struct {
		Team  string `json:"team"`
		Level int    `json:"level"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if (input.Team != "pku" && input.Team != "thu") || input.Level < 7 || input.Level > careerLevelLimit {
		writeError(w, http.StatusBadRequest, "等级奖励无效")
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	user := server.userForTokenLocked(server.token(r))
	if user == nil {
		writeError(w, http.StatusUnauthorized, "尚未登录")
		return
	}
	if server.rejectActiveLocked(w, user.ID) {
		return
	}
	if int64(user.Experience[input.Team]) < experienceForLevel(input.Level) {
		writeError(w, http.StatusForbidden, "尚未达到该等级")
		return
	}
	key := fmt.Sprintf("%s:%d", input.Team, input.Level)
	if user.ClaimedRewards[key] {
		writeJSON(w, http.StatusOK, map[string]any{"profile": server.publicProfileLocked(user), "alreadyClaimed": true})
		return
	}
	oldCards := user.SpeedCards
	oldCosmetics := user.Cosmetics
	oldClaims := user.ClaimedRewards
	user.SpeedCards = make(map[string]int, len(oldCards)+2)
	for k, v := range oldCards {
		user.SpeedCards[k] = v
	}
	user.ClaimedRewards = make(map[string]bool, len(oldClaims)+1)
	for k, v := range oldClaims {
		user.ClaimedRewards[k] = v
	}
	user.Cosmetics = append([]string(nil), oldCosmetics...)
	reward := rewardDefinition(input.Team, input.Level)
	switch reward.Kind {
	case "speed":
		user.SpeedCards[reward.Item]++
	case "bundle":
		user.SpeedCards["2x"] += 2
		user.SpeedCards["4x"]++
	case "cosmetic":
		if !contains(user.Cosmetics, reward.Item) {
			user.Cosmetics = append(user.Cosmetics, reward.Item)
		}
	}
	user.ClaimedRewards[key] = true
	if err := server.saveLocked(); err != nil {
		user.SpeedCards = oldCards
		user.Cosmetics = oldCosmetics
		user.ClaimedRewards = oldClaims
		writeError(w, http.StatusInternalServerError, "奖励暂未保存，请重试")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": server.publicProfileLocked(user), "reward": reward})
}

var serviceCosmeticPattern = regexp.MustCompile(`^(pku|thu)-service-([1-9][0-9]{1,4})\.svg$`)

func serviceCosmeticName(level int) string {
	names := []string{"新锐指挥", "前线精英", "战役功勋", "百战荣誉"}
	return fmt.Sprintf("%s · %d级纪念饰品", names[(level/25-1)%len(names)], level)
}

func renderServiceCosmetic(w http.ResponseWriter, name string) bool {
	parts := serviceCosmeticPattern.FindStringSubmatch(name)
	if parts == nil {
		return false
	}
	level, err := strconv.Atoi(parts[2])
	if err != nil || level%25 != 0 || level > careerLevelLimit {
		return false
	}
	colors := []string{"#bd8452", "#aebbb3", "#73a99e", "#dfc46f"}
	color := colors[(level/25-1)%len(colors)]
	seal := "北"
	base := "#65382f"
	if parts[1] == "thu" {
		seal = "清"
		base = "#394f62"
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = fmt.Fprintf(w, `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="metal" x2="1" y2="1"><stop stop-color="#fff0bd"/><stop offset=".45" stop-color="%s"/><stop offset="1" stop-color="#4b503e"/></linearGradient></defs><rect width="512" height="512" fill="%s"/><path d="M48 25h416v360L256 480 48 385Z" fill="#172923" stroke="url(#metal)" stroke-width="16"/><path d="M71 50h370v320L256 449 71 370Z" fill="none" stroke="%s" stroke-width="3"/><circle cx="256" cy="211" r="132" fill="%s" stroke="url(#metal)" stroke-width="10"/><text x="256" y="264" text-anchor="middle" font-family="sans-serif" font-size="160" font-weight="900" fill="#eee2b4">%s</text><path d="M120 354h272" stroke="%s" stroke-width="4"/><text x="256" y="411" text-anchor="middle" font-family="sans-serif" font-size="51" font-weight="900" fill="%s">%d</text></svg>`, color, base, color, base, seal, color, color, level)
	return true
}
