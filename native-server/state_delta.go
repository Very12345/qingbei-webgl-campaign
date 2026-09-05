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
	units, created, sites, contacts := map[int]json.RawMessage{}, map[int]json.RawMessage{}, map[int]json.RawMessage{}, map[int]json.RawMessage{}
	unitHP := map[int]int{}
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
			unitHP = map[int]int{}
			created = map[int]json.RawMessage{}
			sites = map[int]json.RawMessage{}
			contacts = map[int]json.RawMessage{}
			removed = map[int]bool{}
		}
		delete(fields, "pausedForPlayers")
		for key, value := range patch {
			if key != "units" && key != "unitHp" && key != "newUnits" && key != "removedUnitIds" && key != "sites" && key != "fieldContacts" {
				fields[key] = value
			}
		}
		var fieldContacts []json.RawMessage
		if raw := patch["fieldContacts"]; raw != nil {
			if err := json.Unmarshal(raw, &fieldContacts); err != nil {
				return wireMessage{}, err
			}
		}
		for _, raw := range fieldContacts {
			id, err := deltaID(raw)
			if err != nil {
				return wireMessage{}, err
			}
			contacts[id] = raw
		}
		var hpEntries [][]int
		if raw := patch["unitHp"]; raw != nil {
			if err := json.Unmarshal(raw, &hpEntries); err != nil {
				return wireMessage{}, err
			}
		}
		for _, run := range hpEntries {
			if len(run) != 3 || run[0] < 0 || run[1] < 1 || run[1] > 100000 || run[0] > int(^uint(0)>>1)-run[1] {
				return wireMessage{}, fmt.Errorf("invalid compact HP run")
			}
			for id := run[0]; id < run[0]+run[1]; id++ {
				unitHP[id] = run[2]
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
					delete(unitHP, id)
					delete(removed, id)
				case "units":
					if len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '{' {
						created[id] = raw
						delete(units, id)
					} else {
						units[id] = raw
					}
					delete(unitHP, id)
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
			delete(unitHP, id)
			removed[id] = true
		}
	}
	hpIDs := make([]int, 0, len(unitHP))
	for id := range unitHP {
		hpIDs = append(hpIDs, id)
	}
	sort.Ints(hpIDs)
	hpValues := make([][3]int, 0, len(hpIDs))
	for _, id := range hpIDs {
		hp := unitHP[id]
		if len(hpValues) > 0 && hpValues[len(hpValues)-1][0]+hpValues[len(hpValues)-1][1] == id && hpValues[len(hpValues)-1][2] == hp {
			hpValues[len(hpValues)-1][1]++
		} else {
			hpValues = append(hpValues, [3]int{id, 1, hp})
		}
	}
	if len(hpValues) > 0 {
		fields["unitHp"], _ = json.Marshal(hpValues)
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
	contactIDs := make([]int, 0, len(contacts))
	for id := range contacts {
		contactIDs = append(contactIDs, id)
	}
	sort.Ints(contactIDs)
	if len(contactIDs) > 24 {
		contactIDs = contactIDs[len(contactIDs)-24:]
	}
	fieldContacts := make([]json.RawMessage, 0, len(contactIDs))
	for _, id := range contactIDs {
		fieldContacts = append(fieldContacts, contacts[id])
	}
	if len(fieldContacts) > 0 {
		fields["fieldContacts"], _ = json.Marshal(fieldContacts)
	}
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
