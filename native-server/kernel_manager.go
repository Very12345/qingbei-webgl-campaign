package main

import (
	"errors"
	"sort"
	"strings"
	"sync"
)

type battleSpec struct {
	HumanTeams       []string          `json:"humanTeams,omitempty"`
	ServerOpening    string            `json:"serverOpening,omitempty"`
	Name             string            `json:"name,omitempty"`
	Mode             string            `json:"mode,omitempty"`
	Difficulty       string            `json:"difficulty,omitempty"`
	DifficultyByTeam map[string]string `json:"difficultyByTeam,omitempty"`
	TimeScale        float64           `json:"timeScale,omitempty"`
	MaxPlayers       int               `json:"maxPlayers,omitempty"`
	AllowSameTeam    bool              `json:"allowSameTeam"`
	AuthPlugin       string            `json:"authPlugin,omitempty"`
	Metadata         map[string]any    `json:"metadata,omitempty"`
}

type kernelManager struct {
	mu       sync.RWMutex
	hub      *relayHub
	plugins  *pluginManager
	max      int
	creating int
	battles  map[string]*kernelBattle
	active   string
}

func newKernelManager(hub *relayHub, plugins *pluginManager, maximum int) *kernelManager {
	if maximum < 1 {
		maximum = 1
	}
	return &kernelManager{hub: hub, plugins: plugins, max: maximum, battles: make(map[string]*kernelBattle)}
}

func (manager *kernelManager) create(spec battleSpec) (*kernelBattle, error) {
	return manager.createWithRuntime(spec, nil)
}

func (manager *kernelManager) createWithRuntime(spec battleSpec, runtime *jsKernelRuntime) (*kernelBattle, error) {
	manager.mu.Lock()
	if len(manager.battles)+manager.creating >= manager.max {
		manager.mu.Unlock()
		return nil, errors.New("已达到最大并发内核数")
	}
	manager.creating++
	manager.mu.Unlock()
	var err error
	if runtime == nil {
		runtime, err = newJSKernelRuntime()
		if err != nil {
			manager.mu.Lock()
			manager.creating--
			manager.mu.Unlock()
			return nil, err
		}
	}
	battle, err := newKernelBattleWithSpec(runtime, manager.hub, manager.plugins, spec)
	if err != nil {
		manager.mu.Lock()
		manager.creating--
		manager.mu.Unlock()
		return nil, err
	}
	manager.mu.Lock()
	manager.creating--
	manager.battles[battle.roomCode] = battle
	if manager.active == "" {
		manager.active = battle.roomCode
	}
	manager.mu.Unlock()
	battle.start()
	return battle, nil
}

func (manager *kernelManager) remove(roomCode string) error {
	roomCode = normalizeCode(roomCode)
	manager.mu.Lock()
	battle := manager.battles[roomCode]
	if battle == nil {
		manager.mu.Unlock()
		return errors.New("未找到内核战局")
	}
	delete(manager.battles, roomCode)
	if manager.active == roomCode {
		manager.active = ""
		for code := range manager.battles {
			manager.active = code
			break
		}
	}
	manager.mu.Unlock()
	battle.shutdown()
	manager.hub.mu.Lock()
	delete(manager.hub.rooms, roomCode)
	manager.hub.mu.Unlock()
	return nil
}

func (manager *kernelManager) get(roomCode string) *kernelBattle {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	return manager.battles[normalizeCode(roomCode)]
}

func (manager *kernelManager) activeBattle() *kernelBattle {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	return manager.battles[manager.active]
}

func (manager *kernelManager) selectBattle(roomCode string) bool {
	roomCode = normalizeCode(roomCode)
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.battles[roomCode] == nil {
		return false
	}
	manager.active = roomCode
	return true
}

func (manager *kernelManager) list() []*kernelBattle {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	result := make([]*kernelBattle, 0, len(manager.battles))
	for _, battle := range manager.battles {
		result = append(result, battle)
	}
	sort.Slice(result, func(left, right int) bool { return result[left].roomCode < result[right].roomCode })
	return result
}

func (manager *kernelManager) describe() []map[string]any {
	result := make([]map[string]any, 0)
	for _, battle := range manager.list() {
		snapshot := battle.snapshot()
		result = append(result, map[string]any{
			"roomCode":      battle.roomCode,
			"status":        snapshot.Status,
			"error":         snapshot.Error,
			"players":       len(battle.playerSnapshot()),
			"configuration": battle.infoConfiguration(),
		})
	}
	return result
}

func (manager *kernelManager) shutdown() {
	for _, battle := range manager.list() {
		battle.shutdown()
	}
}

func (manager *kernelManager) execute(roomCode, command string) string {
	battle := manager.get(roomCode)
	if battle == nil {
		return "未找到内核战局"
	}
	return battle.executeCommand(strings.TrimSpace(command))
}
