package main

import "testing"

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
