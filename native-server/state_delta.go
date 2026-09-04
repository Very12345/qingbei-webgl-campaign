package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"
)

func deltaID(raw json.RawMessage) (int, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) > 0 && raw[0] == '[' {
		end := bytes.IndexByte(raw, ',')
		if end < 0 {
			return 0, fmt.Errorf("invalid compact unit")
		}
		return strconv.Atoi(string(bytes.TrimSpace(raw[1:end])))
	}
	var value struct {
		ID *int `json:"id"`
	}
	if err := json.Unmarshal(raw, &value); err != nil || value.ID == nil {
		return 0, fmt.Errorf("missing unit/site ID")
	}
	return *value.ID, nil
}

// Deltas are patches, not complete frames: retain every unsent change while
// newer values supersede older values for the same entity.
func mergeStateDeltas(older, newer wireMessage) (wireMessage, error) {
	fields := map[string]json.RawMessage{}
	units, created, sites := map[int]json.RawMessage{}, map[int]json.RawMessage{}, map[int]json.RawMessage{}
	removed := map[int]bool{}
	for _, message := range []wireMessage{older, newer} {
		var patch map[string]json.RawMessage
		if err := json.Unmarshal([]byte(message.Data), &patch); err != nil {
			return wireMessage{}, err
		}
		if oldEpoch, newEpoch := fields["networkEpoch"], patch["networkEpoch"]; oldEpoch != nil && newEpoch != nil && !bytes.Equal(oldEpoch, newEpoch) {
			var oldValue, newValue uint64
			_ = json.Unmarshal(oldEpoch, &oldValue)
			_ = json.Unmarshal(newEpoch, &newValue)
			if newValue < oldValue {
				continue
			}
			fields = map[string]json.RawMessage{}
			units = map[int]json.RawMessage{}
			created = map[int]json.RawMessage{}
			sites = map[int]json.RawMessage{}
			removed = map[int]bool{}
		}
		delete(fields, "pausedForPlayers")
		for key, value := range patch {
			if key != "units" && key != "newUnits" && key != "removedUnitIds" && key != "sites" {
				fields[key] = value
			}
		}
		for _, name := range []string{"newUnits", "units", "sites"} {
			var entries []json.RawMessage
			if raw := patch[name]; raw != nil {
				if err := json.Unmarshal(raw, &entries); err != nil {
					return wireMessage{}, err
				}
			}
			for _, raw := range entries {
				id, err := deltaID(raw)
				if err != nil {
					return wireMessage{}, err
				}
				switch name {
				case "sites":
					sites[id] = raw
				case "newUnits":
					created[id] = raw
					delete(units, id)
					delete(removed, id)
				case "units":
					if len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '{' {
						created[id] = raw
						delete(units, id)
					} else {
						units[id] = raw
					}
					delete(removed, id)
				}
			}
		}
		var deleted []int
		if raw := patch["removedUnitIds"]; raw != nil {
			if err := json.Unmarshal(raw, &deleted); err != nil {
				return wireMessage{}, err
			}
		}
		for _, id := range deleted {
			delete(units, id)
			delete(created, id)
			removed[id] = true
		}
	}
	for name, entries := range map[string]map[int]json.RawMessage{"units": units, "newUnits": created, "sites": sites} {
		ids := make([]int, 0, len(entries))
		for id := range entries {
			ids = append(ids, id)
		}
		sort.Ints(ids)
		values := make([]json.RawMessage, 0, len(ids))
		for _, id := range ids {
			values = append(values, entries[id])
		}
		fields[name], _ = json.Marshal(values)
	}
	ids := make([]int, 0, len(removed))
	for id := range removed {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	fields["removedUnitIds"], _ = json.Marshal(ids)
	data, err := json.Marshal(fields)
	if err != nil {
		return wireMessage{}, err
	}
	if len(data) > 8<<20 {
		return wireMessage{}, fmt.Errorf("pending state exceeds limit")
	}
	newer.Data = string(data)
	return newer, nil
}

func (battle *kernelBattle) broadcastDelta(encoded string) {
	message := wireMessage{Type: "relay", PeerID: "host", Data: encoded}
	for _, client := range battle.clients() {
		_ = client.sendJSON(message)
	}
}

func (battle *kernelBattle) reportOutcomeJSON(encoded string) {
	battle.mu.RLock()
	reported := battle.resultReported
	battle.mu.RUnlock()
	if reported {
		return
	}
	var summary struct {
		Campaign struct {
			Outcome map[string]any `json:"outcome"`
		} `json:"campaign"`
		ElapsedHours float64        `json:"elapsedHours"`
		Deaths       map[string]int `json:"deaths"`
	}
	if json.Unmarshal([]byte(encoded), &summary) != nil || len(summary.Campaign.Outcome) == 0 {
		return
	}
	battle.reportOutcome(map[string]any{"campaign": map[string]any{"outcome": summary.Campaign.Outcome}, "elapsedHours": summary.ElapsedHours, "deaths": summary.Deaths})
}

func (c *wsClient) writeMeasured(message wireMessage) error {
	start := time.Now()
	err := c.writeJSON(message)
	c.lastWriteMicros.Store(time.Since(start).Microseconds())
	return err
}
