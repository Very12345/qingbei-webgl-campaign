package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type kernelBattle struct {
	runtime       *jsKernelRuntime
	hub           *relayHub
	roomCode      string
	mu            sync.RWMutex
	instance      *jsKernelInstance
	status        string
	lastError     string
	name          string
	maxPlayers    int
	allowSameTeam bool
	timeScale     float64
	stop          chan struct{}
	stopped       chan struct{}
	chat          []map[string]any
	vote          *kernelDecisionVote
}

type simulationHostSnapshot struct {
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	Restarts int    `json:"restarts"`
}

type kernelDecisionVote struct {
	ID         string          `json:"id"`
	DecisionID string          `json:"decisionId"`
	Team       string          `json:"team"`
	Deadline   int64           `json:"deadline"`
	Votes      map[string]bool `json:"votes"`
}

func newKernelBattle(runtime *jsKernelRuntime, hub *relayHub) (*kernelBattle, error) {
	battle := &kernelBattle{
		runtime:       runtime,
		hub:           hub,
		roomCode:      strings.ToUpper(randomID()[:10]),
		status:        "正在初始化共享内核",
		name:          "清北联机服务器",
		maxPlayers:    4,
		allowSameTeam: true,
		timeScale:     1,
		stop:          make(chan struct{}),
		stopped:       make(chan struct{}),
	}
	if err := battle.reset(); err != nil {
		return nil, err
	}
	hub.mu.Lock()
	hub.rooms[battle.roomCode] = &relayRoom{
		kernel: battle,
		guests: make(map[string]*wsClient),
	}
	hub.mu.Unlock()
	battle.status = "运行中"
	return battle, nil
}

func (battle *kernelBattle) reset() error {
	battle.mu.RLock()
	timeScale := battle.timeScale
	battle.mu.RUnlock()
	seed, navGrid, err := loadKernelSeed()
	if err != nil {
		return err
	}
	instance, err := battle.runtime.create(seed, map[string]any{
		"aiTeams":               []string{"pku", "thu"},
		"navGrid":               navGrid,
		"fixedStepMilliseconds": 100,
	})
	if err != nil {
		return err
	}
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": timeScale}); err != nil {
		return err
	}
	battle.mu.Lock()
	battle.instance = instance
	battle.lastError = ""
	battle.mu.Unlock()
	return nil
}

func (battle *kernelBattle) start() {
	go battle.run()
}

func (battle *kernelBattle) run() {
	defer close(battle.stopped)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	last := time.Now()
	lastAutoSave := time.Now()
	lastTeams := map[string]bool{"pku": true, "thu": true}
	for {
		select {
		case <-battle.stop:
			return
		case now := <-ticker.C:
			if now.Sub(lastAutoSave) >= 60*time.Second {
				if _, err := battle.save("autosave"); err != nil {
					battle.setError(fmt.Errorf("自动保存失败: %w", err))
				}
				lastAutoSave = now
			}
			players := battle.playerSnapshot()
			if len(players) == 0 {
				last = now
				continue
			}
			instance := battle.currentInstance()
			if instance == nil {
				continue
			}
			for _, team := range []string{"pku", "thu"} {
				enabled := true
				for _, player := range players {
					if player.team == team {
						enabled = false
						break
					}
				}
				if lastTeams[team] != enabled {
					_ = instance.dispatch(map[string]any{"type": "set_ai_enabled", "team": team, "enabled": enabled})
					lastTeams[team] = enabled
				}
			}
			elapsed := math.Min(250, math.Max(1, float64(now.Sub(last).Milliseconds())))
			last = now
			if _, err := instance.step(elapsed); err != nil {
				battle.setError(err)
				continue
			}
			delta, err := instance.networkDelta()
			if err != nil {
				battle.setError(err)
				continue
			}
			battle.broadcast(delta, "")
		}
	}
}

func (battle *kernelBattle) shutdown() {
	_, _ = battle.save("autosave")
	select {
	case <-battle.stop:
	default:
		close(battle.stop)
	}
	select {
	case <-battle.stopped:
	case <-time.After(2 * time.Second):
	}
}

func (battle *kernelBattle) currentInstance() *jsKernelInstance {
	battle.mu.RLock()
	defer battle.mu.RUnlock()
	return battle.instance
}

func (battle *kernelBattle) setError(err error) {
	battle.mu.Lock()
	battle.lastError = err.Error()
	battle.status = "内核运行异常"
	battle.mu.Unlock()
	log.Printf("共享内核运行异常：%v\n", err)
}

func (battle *kernelBattle) snapshot() simulationHostSnapshot {
	battle.mu.RLock()
	defer battle.mu.RUnlock()
	return simulationHostSnapshot{
		Status: battle.status,
		Error:  battle.lastError,
	}
}

func (battle *kernelBattle) joinConfiguration() (int, bool) {
	battle.mu.RLock()
	defer battle.mu.RUnlock()
	return battle.maxPlayers, battle.allowSameTeam
}

func (battle *kernelBattle) infoConfiguration() map[string]any {
	battle.mu.RLock()
	defer battle.mu.RUnlock()
	return map[string]any{
		"name":          battle.name,
		"maxPlayers":    battle.maxPlayers,
		"allowSameTeam": battle.allowSameTeam,
		"timeScale":     battle.timeScale,
	}
}

func (battle *kernelBattle) playerSnapshot() []consolePlayer {
	battle.hub.mu.RLock()
	defer battle.hub.mu.RUnlock()
	room := battle.hub.rooms[battle.roomCode]
	if room == nil {
		return nil
	}
	players := make([]consolePlayer, 0, len(room.guests))
	for _, guest := range room.guests {
		players = append(players, consolePlayer{id: guest.peerID, nickname: guest.nickname, team: guest.team})
	}
	return players
}

func (battle *kernelBattle) clients() []*wsClient {
	battle.hub.mu.RLock()
	defer battle.hub.mu.RUnlock()
	room := battle.hub.rooms[battle.roomCode]
	if room == nil {
		return nil
	}
	clients := make([]*wsClient, 0, len(room.guests))
	for _, client := range room.guests {
		if client.kernelReady {
			clients = append(clients, client)
		}
	}
	return clients
}

func (battle *kernelBattle) sendApplication(client *wsClient, payload any) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = client.sendJSON(wireMessage{Type: "relay", PeerID: "host", Data: string(encoded)})
}

func (battle *kernelBattle) broadcast(payload any, team string) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	message := wireMessage{Type: "relay", PeerID: "host", Data: string(encoded)}
	for _, client := range battle.clients() {
		if team != "" && client.team != team {
			continue
		}
		_ = client.sendJSON(message)
	}
}

func (battle *kernelBattle) handleClientMessage(client *wsClient, data string) {
	var envelope map[string]any
	if json.Unmarshal([]byte(data), &envelope) != nil {
		return
	}
	typeName, _ := envelope["type"].(string)
	switch typeName {
	case "ping":
		battle.sendApplication(client, map[string]any{"type": "pong", "id": envelope["id"], "sentAt": envelope["sentAt"]})
	case "hello":
		instance := battle.currentInstance()
		if instance == nil {
			return
		}
		full, err := instance.networkFull()
		if err != nil {
			battle.setError(err)
			return
		}
		battle.sendApplication(client, full)
		battle.hub.mu.Lock()
		client.kernelReady = true
		battle.hub.mu.Unlock()
		battle.mu.RLock()
		history := append([]map[string]any(nil), battle.chat...)
		battle.mu.RUnlock()
		battle.sendApplication(client, map[string]any{"type": "chat_history", "messages": history})
	case "client_commands":
		battle.handleCommands(client, envelope)
	case "client_action":
		battle.handleAction(client, envelope["action"])
	case "chat_send":
		battle.handleChat(client, envelope)
	case "decision_vote_request":
		battle.startVote(client, envelope)
	case "decision_vote_cast":
		battle.castVote(client, envelope)
	}
}

func (battle *kernelBattle) handleCommands(client *wsClient, envelope map[string]any) {
	instance := battle.currentInstance()
	if instance == nil {
		return
	}
	revision := intValue(envelope["revision"], -1)
	client.rateMu.Lock()
	if revision <= client.lastRevision {
		client.rateMu.Unlock()
		return
	}
	client.lastRevision = revision
	client.rateMu.Unlock()
	if rawUnits, ok := envelope["units"].([]any); ok {
		if len(rawUnits) > 3_500 {
			rawUnits = rawUnits[:3_500]
		}
		groups := make(map[string]map[string]any)
		for _, raw := range rawUnits {
			command, ok := raw.(map[string]any)
			if !ok || command["team"] != client.team {
				continue
			}
			target := intValue(command["targetSiteId"], -1)
			tx, _ := command["tx"].(float64)
			tz, _ := command["tz"].(float64)
			key := fmt.Sprintf("%d/%.2f/%.2f", target, tx, tz)
			group := groups[key]
			if group == nil {
				group = map[string]any{"type": "order_units", "team": client.team, "unitIds": []any{}, "tx": tx, "tz": tz}
				if target >= 0 {
					group["targetId"] = target
				}
				groups[key] = group
			}
			group["unitIds"] = append(group["unitIds"].([]any), command["id"])
		}
		for _, action := range groups {
			_ = instance.dispatch(action)
		}
	}
	if rawSites, ok := envelope["sites"].([]any); ok {
		if len(rawSites) > 300 {
			rawSites = rawSites[:300]
		}
		for _, raw := range rawSites {
			command, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			action := map[string]any{
				"type":          "configure_site",
				"team":          client.team,
				"siteId":        command["id"],
				"stance":        command["stance"],
				"dispatchRatio": command["dispatchRatio"],
				"displayName":   command["displayName"],
			}
			if rawTarget, exists := command["orderTarget"]; exists {
				if value := intValue(rawTarget, -1); value >= 0 {
					action["orderTarget"] = value
				} else {
					action["orderTarget"] = nil
				}
			}
			if rawTarget, exists := command["plannedOrderTarget"]; exists {
				if value := intValue(rawTarget, -1); value >= 0 {
					action["plannedOrderTarget"] = value
				} else {
					action["plannedOrderTarget"] = nil
				}
			}
			_ = instance.dispatch(action)
		}
	}
}

func (battle *kernelBattle) handleAction(client *wsClient, raw any) {
	if !allowClientRate(client, false, 12, time.Second) {
		return
	}
	action, ok := raw.(map[string]any)
	if !ok {
		return
	}
	kind, _ := action["kind"].(string)
	translated := map[string]any{"team": client.team}
	switch kind {
	case "research":
		translated["type"] = "research_start"
		translated["id"] = action["id"]
	case "production_start":
		translated["type"] = "production_start"
		translated["id"] = action["id"]
	case "production_stop":
		translated["type"] = "production_stop"
		translated["id"] = action["id"]
	case "mobilize":
		translated["type"] = "mobilize"
		translated["stance"] = action["stance"]
	case "build_camp":
		translated["type"] = "build_camp"
		translated["x"] = action["x"]
		translated["z"] = action["z"]
	default:
		return
	}
	if instance := battle.currentInstance(); instance != nil {
		_ = instance.dispatch(translated)
	}
}

func (battle *kernelBattle) handleChat(client *wsClient, envelope map[string]any) {
	if !allowClientRate(client, true, 5, 10*time.Second) {
		return
	}
	text, _ := envelope["text"].(string)
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	if len([]rune(text)) > 200 {
		text = string([]rune(text)[:200])
	}
	channel, _ := envelope["channel"].(string)
	if channel != "team" {
		channel = "all"
	}
	name := client.nickname
	if name == "" {
		name = client.peerID[:8]
	}
	message := map[string]any{
		"id":         "server-" + randomID(),
		"senderId":   client.peerID,
		"senderName": name,
		"senderTeam": client.team,
		"channel":    channel,
		"text":       text,
		"sentAt":     time.Now().UnixMilli(),
	}
	battle.mu.Lock()
	battle.chat = append(battle.chat, message)
	if len(battle.chat) > 100 {
		battle.chat = battle.chat[len(battle.chat)-100:]
	}
	battle.mu.Unlock()
	battle.broadcast(map[string]any{"type": "chat_message", "message": message}, map[bool]string{true: client.team, false: ""}[channel == "team"])
}

func (battle *kernelBattle) startVote(client *wsClient, envelope map[string]any) {
	decisionID, _ := envelope["decisionId"].(string)
	if decisionID == "" {
		return
	}
	battle.mu.Lock()
	if battle.vote != nil {
		battle.mu.Unlock()
		return
	}
	vote := &kernelDecisionVote{
		ID:         "vote-" + randomID(),
		DecisionID: decisionID,
		Team:       client.team,
		Deadline:   time.Now().Add(20 * time.Second).UnixMilli(),
		Votes:      map[string]bool{client.peerID: true},
	}
	battle.vote = vote
	battle.mu.Unlock()
	battle.broadcast(map[string]any{"type": "decision_vote_state", "vote": vote}, "")
	battle.finalizeVoteIfComplete(vote.ID)
	go func() {
		time.Sleep(20 * time.Second)
		battle.finalizeVote(vote.ID)
	}()
}

func (battle *kernelBattle) castVote(client *wsClient, envelope map[string]any) {
	voteID, _ := envelope["voteId"].(string)
	approve, _ := envelope["approve"].(bool)
	battle.mu.Lock()
	if battle.vote == nil || battle.vote.ID != voteID || battle.vote.Team != client.team {
		battle.mu.Unlock()
		return
	}
	battle.vote.Votes[client.peerID] = approve
	vote := battle.vote
	battle.mu.Unlock()
	battle.broadcast(map[string]any{"type": "decision_vote_state", "vote": vote}, "")
	battle.finalizeVoteIfComplete(voteID)
}

func (battle *kernelBattle) finalizeVoteIfComplete(voteID string) {
	battle.mu.RLock()
	vote := battle.vote
	battle.mu.RUnlock()
	if vote == nil || vote.ID != voteID {
		return
	}
	for _, player := range battle.playerSnapshot() {
		if player.team == vote.Team {
			if _, exists := vote.Votes[player.id]; !exists {
				return
			}
		}
	}
	battle.finalizeVote(voteID)
}

func (battle *kernelBattle) finalizeVote(voteID string) {
	players := battle.playerSnapshot()
	battle.mu.Lock()
	vote := battle.vote
	if vote == nil || vote.ID != voteID {
		battle.mu.Unlock()
		return
	}
	yes, no, eligible := 0, 0, 0
	for _, player := range players {
		if player.team != vote.Team {
			continue
		}
		eligible++
		if vote.Votes[player.id] {
			yes++
		} else {
			no++
		}
	}
	battle.vote = nil
	battle.mu.Unlock()
	approved := yes > eligible/2 || (yes == no && yes > 0)
	if approved {
		if instance := battle.currentInstance(); instance != nil {
			_ = instance.dispatch(map[string]any{"type": "decision_start", "team": vote.Team, "id": vote.DecisionID})
		}
	}
	battle.broadcast(map[string]any{"type": "decision_vote_state", "vote": nil}, "")
}

func (battle *kernelBattle) executeCommand(command string) string {
	command = strings.TrimSpace(command)
	name, argument, _ := strings.Cut(command, " ")
	switch strings.ToLower(name) {
	case "status", "battle":
		instance := battle.currentInstance()
		if instance == nil {
			return "共享内核尚未就绪"
		}
		snapshot, err := instance.snapshot()
		if err != nil {
			return err.Error()
		}
		state, _ := snapshot["state"].(map[string]any)
		units, _ := state["units"].([]any)
		sites, _ := state["sites"].([]any)
		return fmt.Sprintf("房间 %s · 游戏时 %.1f 小时 · %d 单位 · %d 据点 · %d 名玩家", battle.roomCode, snapshot["elapsedHours"], len(units), len(sites), len(battle.playerSnapshot()))
	case "new":
		if err := battle.reset(); err != nil {
			return "新建战局失败：" + err.Error()
		}
		for _, client := range battle.clients() {
			if full, err := battle.currentInstance().networkFull(); err == nil {
				battle.sendApplication(client, full)
			}
		}
		return "已创建全新战局"
	case "save":
		name := strings.TrimSpace(argument)
		if name == "" {
			name = "autosave"
		}
		path, err := battle.save(name)
		if err != nil {
			return "保存失败：" + err.Error()
		}
		return "服务器战局已保存：" + path
	case "saves":
		saves, err := battle.listSaves()
		if err != nil {
			return "读取存档失败：" + err.Error()
		}
		if len(saves) == 0 {
			return "尚无服务器存档"
		}
		return "服务器存档：\n  " + strings.Join(saves, "\n  ")
	case "resume":
		name := strings.TrimSpace(argument)
		if err := battle.resume(name); err != nil {
			return "恢复失败：" + err.Error()
		}
		for _, client := range battle.clients() {
			if full, err := battle.currentInstance().networkFull(); err == nil {
				battle.sendApplication(client, full)
			}
		}
		return "已恢复服务器战局"
	case "timescale":
		value, err := strconv.ParseFloat(strings.TrimSpace(argument), 64)
		if err != nil || value < 0.5 || value > 16 {
			return "用法：timescale <0.5-16>"
		}
		battle.mu.Lock()
		battle.timeScale = value
		battle.mu.Unlock()
		if instance := battle.currentInstance(); instance != nil {
			_ = instance.dispatch(map[string]any{"type": "set_time_scale", "value": value})
		}
		return fmt.Sprintf("时间倍率已设为 %.1fx", value)
	case "resource":
		fields := strings.Fields(argument)
		if len(fields) != 2 || (fields[0] != "pku" && fields[0] != "thu") {
			return "用法：resource <pku|thu> <数值>"
		}
		value, err := strconv.ParseFloat(fields[1], 64)
		if err != nil || value < 0 {
			return "资源数值无效"
		}
		if instance := battle.currentInstance(); instance != nil {
			_ = instance.dispatch(map[string]any{"type": "set_resource", "team": fields[0], "value": value})
		}
		return fmt.Sprintf("%s资源已设为 %.0f", teamName(fields[0]), value)
	case "mobilize":
		fields := strings.Fields(argument)
		if len(fields) != 2 || (fields[0] != "pku" && fields[0] != "thu") {
			return "用法：mobilize <pku|thu> <defend|guard|standby>"
		}
		stance := fields[1]
		if stance != "defend" && stance != "guard" && stance != "standby" {
			return "姿态必须是 defend、guard 或 standby"
		}
		if instance := battle.currentInstance(); instance != nil {
			_ = instance.dispatch(map[string]any{"type": "mobilize", "team": fields[0], "stance": stance})
		}
		return teamName(fields[0]) + "已执行总动员"
	case "config":
		battle.mu.RLock()
		name, maxPlayers, allowSameTeam := battle.name, battle.maxPlayers, battle.allowSameTeam
		battle.mu.RUnlock()
		return fmt.Sprintf("%s · 战局码 %s · 最大玩家 %d · 后续同阵营 %t · 时间倍率 %.1fx · 存档目录独立于玩家存档", name, battle.roomCode, maxPlayers, allowSameTeam, battle.timeScale)
	case "set":
		field, value, found := strings.Cut(strings.TrimSpace(argument), " ")
		if !found || strings.TrimSpace(value) == "" {
			return "用法：set <name|maxplayers|sameteam> <值>"
		}
		battle.mu.Lock()
		defer battle.mu.Unlock()
		switch strings.ToLower(field) {
		case "name":
			battle.name = strings.TrimSpace(value)
			if len([]rune(battle.name)) > 32 {
				battle.name = string([]rune(battle.name)[:32])
			}
			return "服务器名称已修改为：" + battle.name
		case "maxplayers":
			maximum, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil || maximum < 2 || maximum > 8 {
				return "最大玩家数必须为 2—8"
			}
			battle.maxPlayers = maximum
			return fmt.Sprintf("最大玩家数已设为 %d", maximum)
		case "sameteam":
			normalized := strings.ToLower(strings.TrimSpace(value))
			if normalized != "on" && normalized != "off" {
				return "sameteam 只能设为 on 或 off"
			}
			battle.allowSameTeam = normalized == "on"
			return fmt.Sprintf("后续同阵营加入：%t", battle.allowSameTeam)
		default:
			return "未知配置项：" + field
		}
	case "maps", "map":
		return "当前服务器使用内嵌地图；使用 resume <服务器存档> 切换战局地图"
	default:
		return "未知内核命令：" + command
	}
}

type kernelSaveFile struct {
	Version       string         `json:"version"`
	Name          string         `json:"name"`
	SavedAt       int64          `json:"savedAt"`
	State         map[string]any `json:"state"`
	ServerName    string         `json:"serverName,omitempty"`
	MaxPlayers    int            `json:"maxPlayers,omitempty"`
	AllowSameTeam bool           `json:"allowSameTeam"`
}

func (battle *kernelBattle) saveDirectory() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	directory := filepath.Join(root, "qingbei-local-server", "server-saves")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	return directory, nil
}

func safeSaveName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "autosave"
	}
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || (char >= '\u4e00' && char <= '\u9fff') {
			builder.WriteRune(char)
		}
	}
	if builder.Len() == 0 {
		return "autosave"
	}
	return string([]rune(builder.String())[:min(len([]rune(builder.String())), 48)])
}

func (battle *kernelBattle) save(name string) (string, error) {
	instance := battle.currentInstance()
	if instance == nil {
		return "", fmt.Errorf("共享内核尚未就绪")
	}
	snapshot, err := instance.snapshot()
	if err != nil {
		return "", err
	}
	state, ok := snapshot["state"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("内核状态格式无效")
	}
	directory, err := battle.saveDirectory()
	if err != nil {
		return "", err
	}
	cleanName := safeSaveName(name)
	path := filepath.Join(directory, cleanName+".json")
	battle.mu.RLock()
	serverName, maxPlayers, allowSameTeam := battle.name, battle.maxPlayers, battle.allowSameTeam
	battle.mu.RUnlock()
	encoded, err := json.Marshal(kernelSaveFile{
		Version:       version,
		Name:          cleanName,
		SavedAt:       time.Now().UnixMilli(),
		State:         state,
		ServerName:    serverName,
		MaxPlayers:    maxPlayers,
		AllowSameTeam: allowSameTeam,
	})
	if err != nil {
		return "", err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, encoded, 0600); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	return path, nil
}

func (battle *kernelBattle) listSaves() ([]string, error) {
	directory, err := battle.saveDirectory()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	type saveEntry struct {
		name string
		at   time.Time
	}
	items := make([]saveEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		info, _ := entry.Info()
		items = append(items, saveEntry{name: strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())), at: info.ModTime()})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].at.After(items[j].at) })
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, fmt.Sprintf("%s · %s", item.name, item.at.Format("2006-01-02 15:04:05")))
	}
	return result, nil
}

func (battle *kernelBattle) resume(name string) error {
	directory, err := battle.saveDirectory()
	if err != nil {
		return err
	}
	var path string
	if strings.TrimSpace(name) != "" {
		path = filepath.Join(directory, safeSaveName(name)+".json")
	} else {
		entries, readErr := os.ReadDir(directory)
		if readErr != nil {
			return readErr
		}
		var newest time.Time
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
				continue
			}
			info, infoErr := entry.Info()
			if infoErr == nil && info.ModTime().After(newest) {
				newest = info.ModTime()
				path = filepath.Join(directory, entry.Name())
			}
		}
	}
	if path == "" {
		return fmt.Errorf("没有可恢复的服务器存档")
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var save kernelSaveFile
	if err := json.Unmarshal(encoded, &save); err != nil {
		return err
	}
	_, navGrid, err := loadKernelSeed()
	if err != nil {
		return err
	}
	instance, err := battle.runtime.create(save.State, map[string]any{
		"aiTeams":               []string{"pku", "thu"},
		"navGrid":               navGrid,
		"fixedStepMilliseconds": 100,
	})
	if err != nil {
		return err
	}
	battle.mu.RLock()
	timeScale := battle.timeScale
	battle.mu.RUnlock()
	if err := instance.dispatch(map[string]any{"type": "set_time_scale", "value": timeScale}); err != nil {
		return err
	}
	battle.mu.Lock()
	battle.instance = instance
	if save.ServerName != "" {
		battle.name = save.ServerName
	}
	if save.MaxPlayers >= 2 && save.MaxPlayers <= 8 {
		battle.maxPlayers = save.MaxPlayers
	}
	battle.allowSameTeam = save.AllowSameTeam
	battle.status = "运行中"
	battle.lastError = ""
	battle.mu.Unlock()
	return nil
}

func intValue(value any, fallback int) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	default:
		return fallback
	}
}

func allowClientRate(client *wsClient, chat bool, limit int, window time.Duration) bool {
	now := time.Now()
	client.rateMu.Lock()
	defer client.rateMu.Unlock()
	if chat {
		if client.chatWindow.IsZero() || now.Sub(client.chatWindow) >= window {
			client.chatWindow = now
			client.chatCount = 0
		}
		if client.chatCount >= limit {
			return false
		}
		client.chatCount++
		return true
	}
	if client.actionWindow.IsZero() || now.Sub(client.actionWindow) >= window {
		client.actionWindow = now
		client.actionCount = 0
	}
	if client.actionCount >= limit {
		return false
	}
	client.actionCount++
	return true
}
