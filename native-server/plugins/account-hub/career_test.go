package main

import (
	"net/http"
	"testing"
)

func TestCareerCountsOnlySettledParticipatingMatches(t *testing.T) {
	server, _ := newTestHub(t)
	user := &userRecord{ID: "commander", Experience: map[string]int{"pku": 380, "thu": 100}}
	server.data.Matches = map[string]*matchRecord{
		"pvp-win":    {Completed: true, Winner: "pku", Mode: "pvp", Participants: map[string]string{"commander": "pku"}},
		"ai-win":     {Completed: true, Winner: "pku", Mode: "ai", Difficulty: "hard", Participants: map[string]string{"commander": "pku"}},
		"loss":       {Completed: true, Winner: "thu", Mode: "ai", Difficulty: "hard", Participants: map[string]string{"commander": "pku"}},
		"other-team": {Completed: true, Winner: "thu", Mode: "pvp", Participants: map[string]string{"commander": "thu"}},
		"active":     {Winner: "pku", Mode: "pvp", Participants: map[string]string{"commander": "pku"}},
		"void":       {Completed: true, Mode: "pvp", Participants: map[string]string{"commander": "pku"}},
		"other-user": {Completed: true, Winner: "pku", Mode: "pvp", Participants: map[string]string{"someone_else": "pku"}},
	}
	career := server.careerForUserLocked(user)
	if career["pku"].Stats != (careerStats{Battles: 3, Wins: 2, TrainingWins: 1, PVPWins: 1, HardWins: 1}) {
		t.Fatalf("incorrect PKU stats: %+v", career["pku"].Stats)
	}
	if career["thu"].Stats.Battles != 1 || career["thu"].Stats.Wins != 1 {
		t.Fatalf("team histories mixed: %+v", career["thu"])
	}
	if !career["pku"].Achievements[0].Unlocked || career["pku"].Achievements[1].Unlocked {
		t.Fatal("achievements did not use settled match counts")
	}
	if career["pku"].LevelStart != 250 || career["pku"].NextExperience != 500 || career["pku"].Rewards[3].Progress != .52 {
		t.Fatalf("incorrect level progress: %+v", career["pku"])
	}
	if user.Experience["pku"] != 380 || len(user.Cosmetics) != 0 || len(user.SpeedCards) != 0 {
		t.Fatal("opening the career mutated account rewards")
	}
}

func TestCareerAchievementThresholds(t *testing.T) {
	achievements := careerAchievements(careerStats{Battles: 60, Wins: 53, PVPWins: 50, TrainingWins: 3, HardWins: 3})
	for _, achievement := range achievements {
		if !achievement.Unlocked || achievement.Current < achievement.Target {
			t.Fatalf("earned achievement remained locked: %+v", achievement)
		}
	}
}

func TestLongCareerCurvePreservesStarterLevelsAndIncreasesCost(t *testing.T) {
	for i, xp := range []int64{0, 100, 250, 500, 900, 1400} {
		if experienceForLevel(i+1) != xp || levelFor(int(xp)) != i+1 {
			t.Fatalf("starter level %d changed", i+1)
		}
	}
	lastCost := int64(500)
	for level := 7; level <= careerLevelLimit; level++ {
		xp := experienceForLevel(level)
		cost := xp - experienceForLevel(level-1)
		if cost <= lastCost || levelFor(int(xp)) != level || levelFor(int(xp-1)) != level-1 {
			t.Fatalf("curve boundary failed at %d", level)
		}
		lastCost = cost
	}
	if experienceForLevel(351) <= experienceForLevel(350) || levelFor(int(experienceForLevel(351))) != 351 {
		t.Fatal("progression stops at 350")
	}
}

func TestCareerRewardCycleAndPagination(t *testing.T) {
	user := &userRecord{Experience: map[string]int{"pku": int(experienceForLevel(351))}}
	for _, entry := range []struct {
		level      int
		kind, item string
	}{{7, "speed", "2x"}, {15, "speed", "4x"}, {20, "bundle", "supplies"}, {25, "cosmetic", "pku-service-25"}, {50, "cosmetic", "pku-service-50"}, {75, "cosmetic", "pku-service-75"}, {360, "bundle", "supplies"}} {
		r := rewardDefinition("pku", entry.level)
		if r.Kind != entry.kind || r.Item != entry.item {
			t.Fatalf("cycle mismatch: %+v", r)
		}
	}
	page := rewardsForPage(user, "pku", 351)
	if len(page) != 50 || page[0].Level != 351 || page[49].Level != 400 || !page[0].Claimable || page[1].Claimable {
		t.Fatal("50-level window mismatch")
	}
}

func TestCareerClaimsAreAuthorizedIdempotentAndPersisted(t *testing.T) {
	server, mux := newTestHub(t)
	user := &userRecord{ID: "commander", Experience: map[string]int{"pku": int(experienceForLevel(50)), "thu": 0}, SpeedCards: map[string]int{"2x": 2}, Cosmetics: []string{"pku-bronze"}}
	server.data.Users[user.ID] = user
	token := server.newSessionLocked(user.ID)
	claim := func(level int, team, session string) int {
		return requestJSON(t, mux, http.MethodPost, "/api/career/claim", map[string]any{"level": level, "team": team}, session).Code
	}
	if claim(7, "pku", "") != http.StatusUnauthorized || claim(7, "thu", token) != http.StatusForbidden || claim(51, "pku", token) != http.StatusForbidden || claim(3, "pku", token) != http.StatusBadRequest {
		t.Fatal("invalid reward request was accepted")
	}
	for i := 0; i < 2; i++ {
		if claim(7, "pku", token) != http.StatusOK || claim(10, "pku", token) != http.StatusOK || claim(25, "pku", token) != http.StatusOK {
			t.Fatal("claim failed")
		}
	}
	if user.SpeedCards["2x"] != 5 || user.SpeedCards["4x"] != 1 || len(user.Cosmetics) != 2 || !contains(user.Cosmetics, "pku-service-25") {
		t.Fatalf("duplicate or incorrect grants: %+v", user.SpeedCards)
	}
	reloaded, newMux := newTestHub(t)
	reloaded.dataFile = server.dataFile
	if err := reloaded.load(); err != nil {
		t.Fatal(err)
	}
	newToken := reloaded.newSessionLocked(user.ID)
	if response := requestJSON(t, newMux, http.MethodPost, "/api/career/claim", map[string]any{"level": 7, "team": "pku"}, newToken); response.Code != http.StatusOK {
		t.Fatal("persisted claim failed")
	}
	if reloaded.data.Users[user.ID].SpeedCards["2x"] != 5 {
		t.Fatal("restart duplicated a reward")
	}
	for _, url := range []string{"/api/career?team=pku&start=51", "/api/career?team=thu&start=351"} {
		if requestJSON(t, mux, http.MethodGet, url, nil, token).Code != http.StatusOK {
			t.Fatal("paging failed")
		}
	}
	if requestJSON(t, mux, http.MethodGet, "/api/career?team=pku&start=2", nil, token).Code != http.StatusBadRequest {
		t.Fatal("invalid page accepted")
	}
}

func TestCareerClaimRollbackAndActiveBattle(t *testing.T) {
	server, mux := newTestHub(t)
	user := &userRecord{ID: "commander", Experience: map[string]int{"pku": 2500}, SpeedCards: map[string]int{"2x": 2}}
	server.data.Users[user.ID] = user
	token := server.newSessionLocked(user.ID)
	server.data.Matches["active"] = &matchRecord{Participants: map[string]string{user.ID: "pku"}}
	input := map[string]any{"team": "pku", "level": 7}
	if requestJSON(t, mux, http.MethodPost, "/api/career/claim", input, token).Code != http.StatusConflict {
		t.Fatal("active player changed inventory")
	}
	delete(server.data.Matches, "active")
	server.dataFile = t.TempDir()
	if requestJSON(t, mux, http.MethodPost, "/api/career/claim", input, token).Code != http.StatusInternalServerError {
		t.Fatal("save failure was ignored")
	}
	if user.SpeedCards["2x"] != 2 || user.ClaimedRewards["pku:7"] {
		t.Fatal("failed save mutated claim or inventory")
	}
}

func TestServiceCosmeticAssetsAreBounded(t *testing.T) {
	_, mux := newTestHub(t)
	for _, name := range []string{"pku-service-25.svg", "thu-service-350.svg", "pku-service-10000.svg"} {
		r := requestJSON(t, mux, http.MethodGet, "/assets/"+name, nil, "")
		if r.Code != http.StatusOK || r.Header().Get("Content-Type") != "image/svg+xml" {
			t.Fatalf("missing milestone art: %s", name)
		}
	}
	for _, name := range []string{"pku-service-26.svg", "thu-service-10025.svg", "pku-service-025.svg", "xxx-service-25.svg"} {
		if requestJSON(t, mux, http.MethodGet, "/assets/"+name, nil, "").Code != http.StatusNotFound {
			t.Fatalf("invalid milestone served: %s", name)
		}
	}
}
