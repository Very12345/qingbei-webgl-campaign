//go:build !windows

package main

import "os/exec"

func hideNodeWindow(command *exec.Cmd) {}
