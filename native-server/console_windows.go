//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func enableVirtualTerminal() bool {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getStdHandle := kernel32.NewProc("GetStdHandle")
	getConsoleMode := kernel32.NewProc("GetConsoleMode")
	setConsoleMode := kernel32.NewProc("SetConsoleMode")
	handle, _, _ := getStdHandle.Call(uintptr(^uint32(10)))
	if handle == 0 || handle == ^uintptr(0) {
		return false
	}
	var mode uint32
	if result, _, _ := getConsoleMode.Call(handle, uintptr(unsafe.Pointer(&mode))); result == 0 {
		return false
	}
	const enableVirtualTerminalProcessing = 0x0004
	if result, _, _ := setConsoleMode.Call(handle, uintptr(mode|enableVirtualTerminalProcessing)); result == 0 {
		return false
	}
	return true
}
