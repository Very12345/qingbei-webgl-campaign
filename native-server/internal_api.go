package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

func registerInternalAPI(mux *http.ServeMux, manager *kernelManager, plugins *pluginManager) {
	authorized := func(request *http.Request) bool {
		return plugins != nil && request.Header.Get("X-Qingbei-Plugin-Secret") == plugins.secret
	}
	mux.HandleFunc("/api/internal/battles", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "forbidden", http.StatusForbidden)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		if request.Method == http.MethodGet {
			_ = json.NewEncoder(writer).Encode(map[string]any{"battles": manager.describe()})
			return
		}
		if request.Method != http.MethodPost {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var spec battleSpec
		if json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10)).Decode(&spec) != nil {
			http.Error(writer, "invalid battle specification", http.StatusBadRequest)
			return
		}
		battle, err := manager.create(spec)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusConflict)
			return
		}
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(map[string]any{"roomCode": battle.roomCode, "configuration": battle.infoConfiguration()})
	})
	mux.HandleFunc("/api/internal/battles/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorized(request) {
			http.Error(writer, "forbidden", http.StatusForbidden)
			return
		}
		remaining := strings.TrimPrefix(request.URL.Path, "/api/internal/battles/")
		parts := strings.Split(strings.Trim(remaining, "/"), "/")
		if len(parts) == 1 && request.Method == http.MethodDelete {
			if err := manager.remove(parts[0]); err != nil {
				http.Error(writer, err.Error(), http.StatusNotFound)
				return
			}
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		if len(parts) != 2 || parts[1] != "command" || request.Method != http.MethodPost {
			http.NotFound(writer, request)
			return
		}
		var payload struct {
			Command string `json:"command"`
		}
		if json.NewDecoder(http.MaxBytesReader(writer, request.Body, 16<<10)).Decode(&payload) != nil {
			http.Error(writer, "invalid command", http.StatusBadRequest)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"result": manager.execute(parts[0], payload.Command)})
	})
}
