package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type pluginProcess struct {
	config  pluginConfig
	baseURL *url.URL
	command *exec.Cmd
	status  string
	error   string
}

type pluginManager struct {
	mu         sync.RWMutex
	secret     string
	configRoot string
	plugins    map[string]*pluginProcess
	client     *http.Client
}

type pluginJoinResponse struct {
	Allow     bool           `json:"allow"`
	Message   string         `json:"message,omitempty"`
	AccountID string         `json:"accountId,omitempty"`
	Profile   map[string]any `json:"profile,omitempty"`
}

func newPluginManager(configRoot string) *pluginManager {
	secretBytes := make([]byte, 32)
	_, _ = rand.Read(secretBytes)
	return &pluginManager{
		secret:     hex.EncodeToString(secretBytes),
		configRoot: configRoot,
		plugins:    make(map[string]*pluginProcess),
		client:     &http.Client{Timeout: 4 * time.Second},
	}
}

func (manager *pluginManager) start(configurations []pluginConfig, serverOrigin string) error {
	for _, configuration := range configurations {
		if err := manager.startOne(configuration, serverOrigin); err != nil {
			if configuration.Required {
				manager.shutdown()
				return err
			}
			log.Printf("可选插件 %s 启动失败：%v\n", configuration.ID, err)
		}
	}
	return nil
}

func (manager *pluginManager) startOne(configuration pluginConfig, serverOrigin string) error {
	id := normalizePluginID(configuration.ID)
	if id == "" || strings.TrimSpace(configuration.Command) == "" {
		return errors.New("插件 id 或 command 为空")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	commandPath := configuration.Command
	if !filepath.IsAbs(commandPath) && strings.ContainsAny(commandPath, `/\\`) {
		commandPath = filepath.Join(manager.configRoot, commandPath)
	}
	command := exec.Command(commandPath, configuration.Args...)
	command.Dir = manager.configRoot
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	environment := append(os.Environ(),
		fmt.Sprintf("QINGBEI_PLUGIN_PORT=%d", port),
		"QINGBEI_PLUGIN_ID="+id,
		"QINGBEI_PLUGIN_SECRET="+manager.secret,
		"QINGBEI_SERVER_ORIGIN="+serverOrigin,
	)
	for key, value := range configuration.Env {
		environment = append(environment, key+"="+value)
	}
	command.Env = environment
	configurePluginCommand(command)
	process := &pluginProcess{
		config:  configuration,
		baseURL: &url.URL{Scheme: "http", Host: fmt.Sprintf("127.0.0.1:%d", port)},
		command: command,
		status:  "正在启动",
	}
	manager.mu.Lock()
	manager.plugins[id] = process
	manager.mu.Unlock()
	if err := command.Start(); err != nil {
		manager.mu.Lock()
		delete(manager.plugins, id)
		manager.mu.Unlock()
		return fmt.Errorf("启动插件 %s: %w", id, err)
	}
	go func() {
		err := command.Wait()
		manager.mu.Lock()
		process.status = "已停止"
		if err != nil {
			process.error = err.Error()
		}
		manager.mu.Unlock()
	}()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		response, err := manager.client.Get(process.baseURL.String() + "/health")
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				manager.mu.Lock()
				process.status = "运行中"
				manager.mu.Unlock()
				log.Printf("插件 %s 已启动：%s\n", id, process.baseURL)
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	_ = command.Process.Kill()
	return fmt.Errorf("插件 %s 健康检查超时", id)
}

func normalizePluginID(value string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(value) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '-' {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

func (manager *pluginManager) registerRoutes(mux *http.ServeMux) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	for id, process := range manager.plugins {
		basePath := process.config.BasePath
		if basePath == "" {
			basePath = "/plugins/" + id + "/"
		}
		if !strings.HasPrefix(basePath, "/") {
			basePath = "/" + basePath
		}
		if !strings.HasSuffix(basePath, "/") {
			basePath += "/"
		}
		proxy := httputil.NewSingleHostReverseProxy(process.baseURL)
		mux.Handle(basePath, http.StripPrefix(strings.TrimSuffix(basePath, "/"), proxy))
	}
}

func (manager *pluginManager) status() []map[string]any {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	result := make([]map[string]any, 0, len(manager.plugins))
	for id, process := range manager.plugins {
		result = append(result, map[string]any{"id": id, "name": process.config.Name, "status": process.status, "error": process.error})
	}
	return result
}

func (manager *pluginManager) call(id, hook string, payload any, result any) error {
	manager.mu.RLock()
	process := manager.plugins[normalizePluginID(id)]
	manager.mu.RUnlock()
	if process == nil || process.status != "运行中" {
		return fmt.Errorf("插件 %s 不可用", id)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, process.baseURL.String()+hook, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Qingbei-Plugin-Secret", manager.secret)
	response, err := manager.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return fmt.Errorf("插件 %s hook %s 返回 %s", id, hook, response.Status)
	}
	if result != nil {
		return json.NewDecoder(response.Body).Decode(result)
	}
	return nil
}

func (manager *pluginManager) authorizeJoin(id, token, room, team, peerID string) (pluginJoinResponse, error) {
	var result pluginJoinResponse
	err := manager.call(id, "/hooks/player/join", map[string]any{
		"token": token, "roomCode": room, "team": team, "peerId": peerID,
	}, &result)
	return result, err
}

func (manager *pluginManager) notify(id, hook string, payload any) {
	if id == "" {
		return
	}
	go func() {
		if err := manager.call(id, hook, payload, nil); err != nil {
			log.Printf("插件 %s 通知 %s 失败：%v\n", id, hook, err)
		}
	}()
}

func (manager *pluginManager) shutdown() {
	manager.mu.RLock()
	processes := make([]*pluginProcess, 0, len(manager.plugins))
	for _, process := range manager.plugins {
		processes = append(processes, process)
	}
	manager.mu.RUnlock()
	for _, process := range processes {
		if process.command.Process != nil {
			_ = process.command.Process.Signal(os.Interrupt)
		}
	}
	time.Sleep(200 * time.Millisecond)
	for _, process := range processes {
		if process.command.Process != nil && process.command.ProcessState == nil {
			_ = process.command.Process.Kill()
		}
	}
}
