//go:build !windows

package main

import "os/exec"

func configurePluginCommand(command *exec.Cmd) {}
