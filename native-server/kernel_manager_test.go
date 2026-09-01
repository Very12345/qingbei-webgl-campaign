package main

import "testing"

func TestKernelManagerCreatesIndependentRuntimes(t *testing.T) {
	hub := newRelayHub()
	manager := newKernelManager(hub, nil, 2)
	first, err := manager.create(battleSpec{Name: "一号", MaxPlayers: 2, AllowSameTeam: true, TimeScale: 1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.create(battleSpec{Name: "二号", MaxPlayers: 2, AllowSameTeam: true, TimeScale: 2})
	if err != nil {
		first.shutdown()
		t.Fatal(err)
	}
	defer manager.shutdown()
	if first.runtime == second.runtime || first.instance == second.instance {
		t.Fatal("each battle must own an independent JS runtime and kernel instance")
	}
	if len(manager.list()) != 2 || len(hub.consoleSnapshot()) != 2 {
		t.Fatal("manager and relay hub must expose both kernels")
	}
	if _, err := manager.create(battleSpec{Name: "超额", MaxPlayers: 2}); err == nil {
		t.Fatal("manager must enforce the configured kernel limit")
	}
}
