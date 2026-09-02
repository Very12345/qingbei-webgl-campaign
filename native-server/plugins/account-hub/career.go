package main

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
	Experience int     `json:"experience"`
	Name       string  `json:"name"`
	Kind       string  `json:"kind"`
	Item       string  `json:"item,omitempty"`
	Progress   float64 `json:"progress"`
	Reached    bool    `json:"reached"`
}

type teamCareer struct {
	Team           string              `json:"team"`
	Level          int                 `json:"level"`
	Experience     int                 `json:"experience"`
	LevelStart     int                 `json:"levelStart"`
	NextExperience int                 `json:"nextExperience"`
	MaxLevel       int                 `json:"maxLevel"`
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
	thresholds := []int{0, 100, 250, 500, 900, 1400}
	for _, team := range []string{"pku", "thu"} {
		xp := user.Experience[team]
		career := teamCareer{Team: team, Level: levelFor(xp), Experience: xp, MaxLevel: len(thresholds)}
		career.LevelStart = thresholds[career.Level-1]
		if career.Level < len(thresholds) {
			career.NextExperience = thresholds[career.Level]
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
		for index, threshold := range thresholds {
			reward := careerReward{Level: index + 1, Experience: threshold, Name: "等级荣誉", Kind: "rank", Reached: xp >= threshold}
			switch reward.Level {
			case 1:
				reward.Name = "加入阵营"
			case 2:
				reward.Name, reward.Kind, reward.Item = "2× 倍速卡", "speed", "2x"
			case 3:
				reward.Name, reward.Kind, reward.Item = "铜色阵营饰品", "cosmetic", team+"-bronze"
			case 4:
				reward.Name, reward.Kind, reward.Item = "4× 倍速卡", "speed", "4x"
			case 5:
				reward.Name, reward.Kind, reward.Item = "金色阵营饰品", "cosmetic", team+"-gold"
			}
			if reward.Reached {
				reward.Progress = 1
			} else if index > 0 && xp > thresholds[index-1] {
				reward.Progress = float64(xp-thresholds[index-1]) / float64(threshold-thresholds[index-1])
			}
			career.Rewards = append(career.Rewards, reward)
		}
		result[team] = career
	}
	return result
}
