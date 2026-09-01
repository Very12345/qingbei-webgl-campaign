package main

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type kernelBenchmarkSample struct {
	Date         string
	Elapsed      float64
	Sites        map[string]int
	Population   map[string]int
	Deaths       map[string]int
	Ratios       map[string]float64
	ActiveRoutes int
	Camps        int
	Outcome      any
}

type kernelBenchmarkResult struct {
	Scenario string
	Samples  []kernelBenchmarkSample
}

func runKernelBenchmark(runtime *jsKernelRuntime, scenario string) (kernelBenchmarkResult, error) {
	seed, navGrid, err := loadKernelSeed()
	if err != nil {
		return kernelBenchmarkResult{}, err
	}
	teams, difficulties, err := benchmarkConfiguration(scenario)
	if err != nil {
		return kernelBenchmarkResult{}, err
	}
	campaign := seed["campaign"].(map[string]any)
	ai := campaign["ai"].(map[string]any)
	ai["difficultyByTeam"] = map[string]any{
		"pku": difficulties["pku"],
		"thu": difficulties["thu"],
	}
	instance, err := runtime.create(seed, map[string]any{
		"aiTeams":               teams,
		"navGrid":               navGrid,
		"fixedStepMilliseconds": 120,
	})
	if err != nil {
		return kernelBenchmarkResult{}, err
	}
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": 16}); err != nil {
		return kernelBenchmarkResult{}, err
	}
	start, _ := time.Parse(time.RFC3339, "2026-08-16T08:00:00+08:00")
	dates := []string{
		"2026-08-19T20:00:00+08:00",
		"2026-08-22T00:00:00+08:00",
		"2026-08-25T00:00:00+08:00",
		"2026-08-29T00:00:00+08:00",
		"2026-09-02T00:00:00+08:00",
		"2026-09-06T00:00:00+08:00",
		"2026-09-16T00:00:00+08:00",
		"2026-09-26T00:00:00+08:00",
	}
	switch {
	case scenario == "pku-hard-idle" || scenario == "thu-hard-idle":
		dates = dates[:6]
	case scenario == "pku-standard-idle" ||
		scenario == "thu-standard-idle" ||
		strings.Contains(scenario, "-vs-"):
		dates = dates[:7]
	}
	result := kernelBenchmarkResult{Scenario: scenario}
	elapsed := 0.0
	for _, dateText := range dates {
		date, _ := time.Parse(time.RFC3339, dateText)
		targetHours := date.Sub(start).Hours()
		iterations := int(math.Ceil((targetHours - elapsed) / 0.72))
		if iterations < 0 {
			iterations = 0
		}
		snapshot, err := instance.run(iterations, 250)
		if err != nil {
			return kernelBenchmarkResult{}, err
		}
		elapsed, _ = snapshot["elapsedHours"].(float64)
		sample := summarizeKernelSnapshot(dateText, snapshot)
		result.Samples = append(result.Samples, sample)
		if sample.Outcome != nil {
			break
		}
	}
	return result, nil
}

func benchmarkConfiguration(scenario string) ([]string, map[string]string, error) {
	difficulties := map[string]string{"pku": "standard", "thu": "standard"}
	switch strings.ToLower(strings.TrimSpace(scenario)) {
	case "pku-hard-idle":
		difficulties["pku"] = "hard"
		return []string{"pku"}, difficulties, nil
	case "thu-hard-idle":
		difficulties["thu"] = "hard"
		return []string{"thu"}, difficulties, nil
	case "pku-standard-idle":
		return []string{"pku"}, difficulties, nil
	case "thu-standard-idle":
		return []string{"thu"}, difficulties, nil
	case "pku-hard-vs-thu-standard":
		difficulties["pku"] = "hard"
		return []string{"pku", "thu"}, difficulties, nil
	case "thu-hard-vs-pku-standard":
		difficulties["thu"] = "hard"
		return []string{"pku", "thu"}, difficulties, nil
	case "hard-mirror":
		difficulties["pku"] = "hard"
		difficulties["thu"] = "hard"
		return []string{"pku", "thu"}, difficulties, nil
	default:
		return nil, nil, fmt.Errorf("未知基准场景 %q", scenario)
	}
}

func summarizeKernelSnapshot(date string, snapshot map[string]any) kernelBenchmarkSample {
	state := snapshot["state"].(map[string]any)
	sites := map[string]int{"pku": 0, "thu": 0}
	for _, raw := range state["sites"].([]any) {
		site := raw.(map[string]any)
		if destroyed, _ := site["destroyed"].(bool); destroyed {
			continue
		}
		team, _ := site["team"].(string)
		sites[team]++
	}
	population := map[string]int{"pku": 0, "thu": 0}
	activeRoutes := 0
	for _, raw := range state["units"].([]any) {
		unit := raw.(map[string]any)
		team, _ := unit["team"].(string)
		strength, _ := unit["strength"].(float64)
		population[team] += int(strength)
		if _, moving := unit["targetSiteId"]; moving {
			activeRoutes++
		}
	}
	camps := 0
	for _, raw := range state["sites"].([]any) {
		site := raw.(map[string]any)
		if site["type"] == "camp" {
			camps++
		}
	}
	rawDeaths := state["deaths"].(map[string]any)
	deaths := map[string]int{
		"pku": int(rawDeaths["pku"].(float64)),
		"thu": int(rawDeaths["thu"].(float64)),
	}
	ratios := map[string]float64{
		"pku": float64(deaths["pku"]) / math.Max(1, float64(deaths["thu"])),
		"thu": float64(deaths["thu"]) / math.Max(1, float64(deaths["pku"])),
	}
	campaign := state["campaign"].(map[string]any)
	return kernelBenchmarkSample{
		Date:         date,
		Elapsed:      snapshot["elapsedHours"].(float64),
		Sites:        sites,
		Population:   population,
		Deaths:       deaths,
		Ratios:       ratios,
		ActiveRoutes: activeRoutes,
		Camps:        camps,
		Outcome:      campaign["outcome"],
	}
}
