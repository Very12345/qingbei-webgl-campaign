package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type serverConfig struct {
	InitialKernels int            `json:"initialKernels"`
	MaxKernels     int            `json:"maxKernels"`
	LandingPlugin  string         `json:"landingPlugin,omitempty"`
	Plugins        []pluginConfig `json:"plugins,omitempty"`
}

type pluginConfig struct {
	ID       string            `json:"id"`
	Name     string            `json:"name,omitempty"`
	Command  string            `json:"command"`
	Args     []string          `json:"args,omitempty"`
	BasePath string            `json:"basePath,omitempty"`
	Required bool              `json:"required,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
}

func defaultServerConfig() serverConfig {
	return serverConfig{InitialKernels: 1, MaxKernels: 4}
}

func loadServerConfig(filename string) (serverConfig, string, error) {
	configuration := defaultServerConfig()
	if filename == "" {
		return configuration, ".", nil
	}
	absolute, err := filepath.Abs(filename)
	if err != nil {
		return configuration, "", err
	}
	data, err := os.ReadFile(absolute)
	if errors.Is(err, os.ErrNotExist) {
		return configuration, filepath.Dir(absolute), nil
	}
	if err != nil {
		return configuration, "", err
	}
	if err := json.Unmarshal(data, &configuration); err != nil {
		return configuration, "", err
	}
	if configuration.InitialKernels < 0 {
		configuration.InitialKernels = 0
	}
	if configuration.MaxKernels < 1 {
		configuration.MaxKernels = 1
	}
	if configuration.MaxKernels > 16 {
		configuration.MaxKernels = 16
	}
	if configuration.InitialKernels > configuration.MaxKernels {
		configuration.InitialKernels = configuration.MaxKernels
	}
	return configuration, filepath.Dir(absolute), nil
}
