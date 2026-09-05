package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func statePacket(data string) wireMessage {
	return wireMessage{Type: "relay", PeerID: "host", Data: data}
}
func TestSlowClientRetainsUnsentDeltaChanges(t *testing.T) {
	c := &wsClient{done: make(chan struct{}), outbound: make(chan wireMessage, 8), stateSignal: make(chan struct{}, 1)}
	a := statePacket(`{"type":"state_delta","revision":1,"units":[[1,0,10]],"sites":[{"id":9,"orderTarget":42}],"removedUnitIds":[],"campaign":{"warUnlocked":true}}`)
	b := statePacket(`{"type":"state_delta","revision":2,"units":[[2,1,20]],"sites":[],"removedUnitIds":[]}`)
	if err := c.sendJSON(a); err != nil {
		t.Fatal(err)
	}
	if err := c.sendJSON(b); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Revision int
		Units    [][]int
		Sites    []struct{ ID, OrderTarget int }
		Campaign map[string]any
	}
	if err := json.Unmarshal([]byte(c.latestState.Data), &result); err != nil {
		t.Fatal(err)
	}
	if result.Revision != 2 || len(result.Units) != 2 || len(result.Sites) != 1 || result.Sites[0].OrderTarget != 42 || result.Campaign["warUnlocked"] != true {
		t.Fatalf("incremental data was dropped: %s", c.latestState.Data)
	}
	if len(c.stateSignal) != 1 || c.mergedDeltas.Load() != 1 {
		t.Fatal("queue is not bounded")
	}
}

func TestSlowClientRetainsBoundedFieldContacts(t *testing.T) {
	older := statePacket(`{"type":"state_delta","revision":1,"units":[],"sites":[],"removedUnitIds":[],"fieldContacts":[{"id":1,"x":1},{"id":2,"x":2}]}`)
	newer := statePacket(`{"type":"state_delta","revision":2,"units":[],"sites":[],"removedUnitIds":[],"fieldContacts":[{"id":2,"x":20},{"id":3,"x":3}]}`)
	merged, err := mergeStateDeltas(older, newer)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		FieldContacts []struct {
			ID int
			X  float64
		}
	}
	if err := json.Unmarshal([]byte(merged.Data), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.FieldContacts) != 3 || result.FieldContacts[0].ID != 1 || result.FieldContacts[1].X != 20 || result.FieldContacts[2].ID != 3 {
		t.Fatal(merged.Data)
	}
	for id := 4; id <= 30; id++ {
		packet := statePacket(fmt.Sprintf(`{"type":"state_delta","revision":%d,"units":[],"sites":[],"removedUnitIds":[],"fieldContacts":[{"id":%d}]}`, id, id))
		merged, err = mergeStateDeltas(merged, packet)
		if err != nil {
			t.Fatal(err)
		}
	}
	result.FieldContacts = nil
	_ = json.Unmarshal([]byte(merged.Data), &result)
	if len(result.FieldContacts) != 24 || result.FieldContacts[0].ID != 7 || result.FieldContacts[23].ID != 30 {
		t.Fatal(merged.Data)
	}
}

func TestSlowClientMergesCompactHPWithoutOverridingNewerUnits(t *testing.T) {
	older := statePacket(`{"type":"state_delta","revision":1,"units":[[1,0,10],[2,0,20]],"unitHp":[[3,1,997]],"sites":[],"removedUnitIds":[]}`)
	newer := statePacket(`{"type":"state_delta","revision":2,"units":[[3,1,30]],"unitHp":[[1,1,985],[2,1,975]],"sites":[],"removedUnitIds":[2]}`)
	merged, err := mergeStateDeltas(older, newer)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Units          [][]int `json:"units"`
		UnitHP         [][]int `json:"unitHp"`
		RemovedUnitIds []int   `json:"removedUnitIds"`
	}
	if err := json.Unmarshal([]byte(merged.Data), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Units) != 2 || result.Units[0][0] != 1 || result.Units[1][0] != 3 || len(result.UnitHP) != 1 || result.UnitHP[0][0] != 1 || result.UnitHP[0][1] != 1 || result.UnitHP[0][2] != 985 || len(result.RemovedUnitIds) != 1 || result.RemovedUnitIds[0] != 2 {
		t.Fatal(merged.Data)
	}
}

func TestDeltaCreationUpdatesRemovalAndRecreation(t *testing.T) {
	packets := []wireMessage{
		statePacket(`{"type":"state_delta","revision":1,"newUnits":[{"id":5,"team":"pku","x":1}],"units":[[8,0,2]],"sites":[],"removedUnitIds":[]}`),
		statePacket(`{"type":"state_delta","revision":2,"units":[[5,0,99]],"sites":[],"removedUnitIds":[8]}`),
	}
	merged, err := mergeStateDeltas(packets[0], packets[1])
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		NewUnits       []map[string]any
		Units          [][]int
		RemovedUnitIds []int
	}
	_ = json.Unmarshal([]byte(merged.Data), &result)
	if len(result.NewUnits) != 1 || result.Units[0][2] != 99 || len(result.RemovedUnitIds) != 1 {
		t.Fatal(merged.Data)
	}
	merged, err = mergeStateDeltas(merged, statePacket(`{"type":"state_delta","revision":3,"newUnits":[{"id":8,"team":"thu"}],"units":[],"sites":[],"removedUnitIds":[5]}`))
	if err != nil {
		t.Fatal(err)
	}
	result = struct {
		NewUnits       []map[string]any
		Units          [][]int
		RemovedUnitIds []int
	}{}
	_ = json.Unmarshal([]byte(merged.Data), &result)
	if len(result.NewUnits) != 1 || result.NewUnits[0]["id"] != float64(8) || len(result.Units) != 0 || len(result.RemovedUnitIds) != 1 || result.RemovedUnitIds[0] != 5 {
		t.Fatal(merged.Data)
	}
}

func TestSnapshotBarrierPreservesNewerDeltas(t *testing.T) {
	c := &wsClient{done: make(chan struct{}), outbound: make(chan wireMessage, 8), stateSignal: make(chan struct{}, 1)}
	_ = c.sendJSON(statePacket(`{"type":"state_delta","revision":10,"units":[],"sites":[{"id":1,"orderTarget":9}],"removedUnitIds":[]}`))
	_ = c.sendJSON(statePacket(`{"type":"state","revision":9,"game":{}}`))
	if c.latestState == nil {
		t.Fatal("snapshot discarded a newer update")
	}
	_ = c.sendJSON(statePacket(`{"type":"state","revision":10,"game":{}}`))
	if c.latestState != nil {
		t.Fatal("old delta remained after a complete snapshot")
	}
}

func TestPausedDeltaDoesNotKeepGamePausedAfterResume(t *testing.T) {
	merged, err := mergeStateDeltas(statePacket(`{"type":"state_delta","revision":1,"networkEpoch":1,"pausedForPlayers":true,"units":[],"sites":[],"removedUnitIds":[]}`), statePacket(`{"type":"state_delta","revision":2,"networkEpoch":1,"units":[],"sites":[],"removedUnitIds":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	_ = json.Unmarshal([]byte(merged.Data), &value)
	if value["pausedForPlayers"] == true {
		t.Fatal("resumed game stayed paused")
	}
	merged, err = mergeStateDeltas(statePacket(`{"type":"state_delta","revision":100,"networkEpoch":1,"units":[[9,0,9]],"sites":[],"removedUnitIds":[]}`), statePacket(`{"type":"state_delta","revision":1,"networkEpoch":2,"units":[],"sites":[],"removedUnitIds":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(merged.Data), &value)
	if len(value["units"].([]any)) != 0 {
		t.Fatal("restored game inherited old-epoch deltas")
	}
}

func TestPerformanceEndpointDoesNotWaitForSimulationLock(t *testing.T) {
	rt := &jsKernelRuntime{}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	b := &kernelBattle{hub: newRelayHub(), runtime: rt, roomCode: "TEST"}
	b.recordTick(time.Now(), 12*time.Millisecond, 3*time.Millisecond, 4096, false)
	manager := newKernelManager(b.hub, nil, 1)
	manager.battles["TEST"] = b
	monitor := &performanceMonitor{value: serverPerformance{CPUCores: 1, Heap: 123}}
	mux := http.NewServeMux()
	registerPerformanceAPI(mux, manager, monitor)
	done := make(chan int, 1)
	go func() {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/performance?room=TEST", nil))
		done <- rec.Code
	}()
	select {
	case code := <-done:
		if code != 200 {
			t.Fatal(code)
		}
	case <-time.After(time.Second):
		t.Fatal("diagnostics stalled behind the JS VM")
	}
}
