package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type simulationHost struct {
	command *exec.Cmd
	done    chan error
}

func startSimulationHost(targetURL string) (*simulationHost, error) {
	browser, err := findHeadlessBrowser()
	if err != nil {
		return nil, err
	}
	configRoot, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	profile := filepath.Join(configRoot, "qingbei-local-server", "browser-profile")
	if err := os.MkdirAll(profile, 0700); err != nil {
		return nil, err
	}
	terminateStaleBrowser(profile)
	arguments := []string{
		"--headless=new",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--mute-audio",
		"--window-size=64,64",
		"--no-first-run",
		"--no-default-browser-check",
		"--remote-debugging-port=0",
		"--user-data-dir=" + profile,
		targetURL,
	}
	command := exec.Command(browser, arguments...)
	command.Stdout = io.Discard
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return nil, err
	}
	host := &simulationHost{command: command, done: make(chan error, 1)}
	go func() {
		host.done <- command.Wait()
		close(host.done)
	}()
	return host, nil
}

func (host *simulationHost) stop() {
	if host == nil || host.command == nil || host.command.Process == nil {
		return
	}
	_ = host.command.Process.Kill()
}

type simulationHostSnapshot struct {
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	Restarts int    `json:"restarts"`
}

type simulationHostController struct {
	targetURL string
	hub       *relayHub
	mu        sync.RWMutex
	current   *simulationHost
	status    string
	lastError string
	restarts  int
	restart   chan struct{}
	stop      chan struct{}
	stopped   chan struct{}
	stopOnce  sync.Once
}

func newSimulationHostController(targetURL string, hub *relayHub) *simulationHostController {
	return &simulationHostController{
		targetURL: targetURL,
		hub:       hub,
		status:    "等待启动",
		restart:   make(chan struct{}, 1),
		stop:      make(chan struct{}),
		stopped:   make(chan struct{}),
	}
}

func (controller *simulationHostController) start() {
	go controller.run()
}

func (controller *simulationHostController) run() {
	defer close(controller.stopped)
	for {
		if controller.stopping() {
			return
		}
		controller.setState("正在启动后台战局", "")
		host, err := startSimulationHost(controller.targetURL)
		if err != nil {
			controller.setState("启动失败", err.Error())
			terminalError("后台战局主机启动失败：" + err.Error())
			if !controller.waitBeforeRetry() {
				return
			}
			continue
		}
		controller.mu.Lock()
		controller.current = host
		controller.mu.Unlock()

		ready := false
		deadline := time.NewTimer(20 * time.Second)
		ticker := time.NewTicker(350 * time.Millisecond)
	readyLoop:
		for !ready {
			select {
			case <-controller.stop:
				host.stop()
				ticker.Stop()
				deadline.Stop()
				return
			case <-controller.restart:
				host.stop()
				ticker.Stop()
				deadline.Stop()
				controller.incrementRestart()
				break readyLoop
			case err := <-host.done:
				ticker.Stop()
				deadline.Stop()
				controller.setState("后台进程已退出", errorText(err))
				controller.incrementRestart()
				break readyLoop
			case <-ticker.C:
				_, online, _ := controller.hub.activeRoomStatus()
				if online {
					ready = true
					ticker.Stop()
					deadline.Stop()
					controller.setState("运行中", "")
					terminalSuccess("后台战局已完成注册，玩家现在可以直接进入。")
				}
			case <-deadline.C:
				ticker.Stop()
				host.stop()
				controller.setState("战局注册超时", "后台浏览器已启动，但20秒内没有创建房间")
				terminalWarning("后台战局注册超时，正在自动清理并重启。")
				controller.incrementRestart()
				break readyLoop
			}
		}
		if !ready {
			if !controller.waitBeforeRetry() {
				return
			}
			continue
		}

		missingSince := time.Time{}
		monitor := time.NewTicker(2 * time.Second)
	monitorLoop:
		for {
			select {
			case <-controller.stop:
				host.stop()
				monitor.Stop()
				return
			case <-controller.restart:
				host.stop()
				monitor.Stop()
				controller.incrementRestart()
				break monitorLoop
			case err := <-host.done:
				monitor.Stop()
				controller.setState("后台进程已退出", errorText(err))
				controller.incrementRestart()
				break monitorLoop
			case <-monitor.C:
				_, online, _ := controller.hub.activeRoomStatus()
				if online {
					missingSince = time.Time{}
					continue
				}
				if missingSince.IsZero() {
					missingSince = time.Now()
				}
				if time.Since(missingSince) >= 12*time.Second {
					monitor.Stop()
					host.stop()
					controller.setState("战局连接丢失", "房间持续12秒未注册")
					terminalWarning("后台战局连接丢失，正在自动重启。")
					controller.incrementRestart()
					break monitorLoop
				}
			}
		}
		if !controller.waitBeforeRetry() {
			return
		}
	}
}

func (controller *simulationHostController) waitBeforeRetry() bool {
	select {
	case <-controller.stop:
		return false
	case <-controller.restart:
		return true
	case <-time.After(2 * time.Second):
		return true
	}
}

func (controller *simulationHostController) stopping() bool {
	select {
	case <-controller.stop:
		return true
	default:
		return false
	}
}

func (controller *simulationHostController) setState(status, lastError string) {
	controller.mu.Lock()
	controller.status = status
	controller.lastError = lastError
	controller.mu.Unlock()
}

func (controller *simulationHostController) incrementRestart() {
	controller.mu.Lock()
	controller.restarts++
	controller.current = nil
	controller.mu.Unlock()
}

func (controller *simulationHostController) snapshot() simulationHostSnapshot {
	controller.mu.RLock()
	defer controller.mu.RUnlock()
	return simulationHostSnapshot{
		Status:   controller.status,
		Error:    controller.lastError,
		Restarts: controller.restarts,
	}
}

func (controller *simulationHostController) requestRestart() {
	select {
	case controller.restart <- struct{}{}:
	default:
	}
}

func (controller *simulationHostController) shutdown() {
	controller.stopOnce.Do(func() { close(controller.stop) })
	select {
	case <-controller.stopped:
	case <-time.After(3 * time.Second):
	}
}

func errorText(err error) string {
	if err == nil {
		return "进程正常退出"
	}
	return err.Error()
}

func terminateStaleBrowser(profile string) {
	if runtime.GOOS == "windows" {
		escaped := strings.ReplaceAll(profile, "'", "''")
		script := fmt.Sprintf("$p='%s'; Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge)\\.exe$' -and $_.CommandLine -like ('*'+$p+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }", escaped)
		_ = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script).Run()
		return
	}
	_ = exec.Command("pkill", "-f", "--user-data-dir="+profile).Run()
}

func findHeadlessBrowser() (string, error) {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		candidates = []string{
			filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		}
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"} {
			if path, err := exec.LookPath(name); err == nil {
				candidates = append(candidates, path)
			}
		}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("未找到 Chrome、Chromium 或 Edge；请安装其中任意一个浏览器")
}
