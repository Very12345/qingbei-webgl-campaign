package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
)

var terminalColor = os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb" && enableVirtualTerminal()

const (
	ansiReset   = "\x1b[0m"
	ansiBold    = "\x1b[1m"
	ansiDim     = "\x1b[2m"
	ansiRed     = "\x1b[31m"
	ansiGreen   = "\x1b[32m"
	ansiYellow  = "\x1b[33m"
	ansiBlue    = "\x1b[34m"
	ansiMagenta = "\x1b[35m"
	ansiCyan    = "\x1b[36m"
	ansiWhite   = "\x1b[37m"
)

func paint(code, text string) string {
	if !terminalColor {
		return text
	}
	return code + text + ansiReset
}

func printTerminalBanner(currentVersion string) {
	fmt.Println(paint(ansiCyan+ansiBold, "╔══════════════════════════════════════════════════════╗"))
	fmt.Printf("%s  %s  %s\n", paint(ansiCyan+ansiBold, "║"), paint(ansiYellow+ansiBold, "解放清华园 · 专用服务器终端"), paint(ansiCyan+ansiBold, "║"))
	fmt.Printf("%s  版本 %-46s%s\n", paint(ansiCyan+ansiBold, "║"), currentVersion, paint(ansiCyan+ansiBold, "║"))
	fmt.Println(paint(ansiCyan+ansiBold, "╚══════════════════════════════════════════════════════╝"))
}

func terminalPrompt() {
	fmt.Print(paint(ansiGreen+ansiBold, "server> "))
}

func terminalInfo(text string)    { fmt.Println(paint(ansiCyan, text)) }
func terminalSuccess(text string) { fmt.Println(paint(ansiGreen, text)) }
func terminalWarning(text string) { fmt.Println(paint(ansiYellow, text)) }
func terminalError(text string)   { fmt.Println(paint(ansiRed, text)) }

func terminalCommandResult(text string) {
	formatted := text
	if json.Valid([]byte(text)) {
		var buffer bytes.Buffer
		if json.Indent(&buffer, []byte(text), "", "  ") == nil {
			formatted = buffer.String()
		}
	}
	fmt.Printf("\n%s\n%s\n", paint(ansiGreen+ansiBold, "✓ 命令执行完成"), paint(ansiWhite, formatted))
}
