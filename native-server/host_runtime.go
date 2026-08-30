package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type simulationHost struct {
	command *exec.Cmd
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
	host := &simulationHost{command: command}
	go func() {
		_ = command.Wait()
	}()
	return host, nil
}

func (host *simulationHost) stop() {
	if host == nil || host.command == nil || host.command.Process == nil {
		return
	}
	_ = host.command.Process.Kill()
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
