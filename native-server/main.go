package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

var version = "dev"

//go:embed web/*
var embeddedWeb embed.FS

type wireMessage struct {
	Type    string `json:"type"`
	PeerID  string `json:"peerId,omitempty"`
	Team    string `json:"team,omitempty"`
	Data    string `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

type wsClient struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	room   string
	role   string
	team   string
	peerID string
	hub    *relayHub
}

func (c *wsClient) sendJSON(message wireMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return c.writeFrame(0x1, payload)
}

func (c *wsClient) writeFrame(opcode byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(payload) > 16<<20 {
		return errors.New("websocket payload too large")
	}
	header := []byte{0x80 | opcode}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 65535:
		header = append(header, 126, 0, 0)
		binary.BigEndian.PutUint16(header[len(header)-2:], uint16(len(payload)))
	default:
		header = append(header, 127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(header[len(header)-8:], uint64(len(payload)))
	}
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}

func (c *wsClient) readLoop() {
	defer func() {
		c.hub.unregister(c)
		_ = c.conn.Close()
	}()
	var fragmented []byte
	for {
		opcode, final, payload, err := readFrame(c.reader)
		if err != nil {
			return
		}
		switch opcode {
		case 0x8:
			_ = c.writeFrame(0x8, nil)
			return
		case 0x9:
			_ = c.writeFrame(0xA, payload)
		case 0x0:
			fragmented = append(fragmented, payload...)
			if final {
				c.handleMessage(fragmented)
				fragmented = nil
			}
		case 0x1, 0x2:
			if final {
				c.handleMessage(payload)
			} else {
				fragmented = append(fragmented[:0], payload...)
			}
		}
	}
}

func (c *wsClient) handleMessage(payload []byte) {
	var message wireMessage
	if json.Unmarshal(payload, &message) != nil {
		return
	}
	c.hub.relay(c, message)
}

func readFrame(reader *bufio.Reader) (opcode byte, final bool, payload []byte, err error) {
	first, err := reader.ReadByte()
	if err != nil {
		return 0, false, nil, err
	}
	second, err := reader.ReadByte()
	if err != nil {
		return 0, false, nil, err
	}
	final = first&0x80 != 0
	opcode = first & 0x0f
	masked := second&0x80 != 0
	length := uint64(second & 0x7f)
	if length == 126 {
		var value uint16
		if err = binary.Read(reader, binary.BigEndian, &value); err != nil {
			return
		}
		length = uint64(value)
	} else if length == 127 {
		if err = binary.Read(reader, binary.BigEndian, &length); err != nil {
			return
		}
	}
	if length > 16<<20 {
		return 0, false, nil, errors.New("websocket frame exceeds 16 MiB")
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(reader, mask[:]); err != nil {
			return
		}
	}
	payload = make([]byte, int(length))
	if _, err = io.ReadFull(reader, payload); err != nil {
		return
	}
	if masked {
		for index := range payload {
			payload[index] ^= mask[index%4]
		}
	}
	return
}

type relayRoom struct {
	host   *wsClient
	guests map[string]*wsClient
}

type relayHub struct {
	mu    sync.RWMutex
	rooms map[string]*relayRoom
}

func newRelayHub() *relayHub {
	return &relayHub{rooms: make(map[string]*relayRoom)}
}

func (hub *relayHub) register(client *wsClient) error {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	room := hub.rooms[client.room]
	if room == nil {
		room = &relayRoom{guests: make(map[string]*wsClient)}
		hub.rooms[client.room] = room
	}
	if client.role == "host" {
		if room.host != nil {
			return errors.New("room already has a host")
		}
		room.host = client
		return nil
	}
	if room.host == nil {
		return errors.New("room host is offline")
	}
	room.guests[client.peerID] = client
	return nil
}

func (hub *relayHub) announce(client *wsClient) {
	hub.mu.RLock()
	room := hub.rooms[client.room]
	var host *wsClient
	if room != nil {
		host = room.host
	}
	hub.mu.RUnlock()
	if client.role == "guest" && host != nil {
		_ = host.sendJSON(wireMessage{Type: "peer_join", PeerID: client.peerID, Team: client.team})
		_ = client.sendJSON(wireMessage{Type: "ready", PeerID: "host"})
	}
}

func (hub *relayHub) unregister(client *wsClient) {
	hub.mu.Lock()
	room := hub.rooms[client.room]
	if room == nil {
		hub.mu.Unlock()
		return
	}
	if client.role == "host" && room.host == client {
		room.host = nil
		guests := make([]*wsClient, 0, len(room.guests))
		for _, guest := range room.guests {
			guests = append(guests, guest)
		}
		delete(hub.rooms, client.room)
		hub.mu.Unlock()
		for _, guest := range guests {
			_ = guest.sendJSON(wireMessage{Type: "error", Message: "服务器已停止"})
			_ = guest.conn.Close()
		}
		return
	}
	delete(room.guests, client.peerID)
	host := room.host
	if host == nil && len(room.guests) == 0 {
		delete(hub.rooms, client.room)
	}
	hub.mu.Unlock()
	if host != nil {
		_ = host.sendJSON(wireMessage{Type: "peer_leave", PeerID: client.peerID})
	}
}

func (hub *relayHub) relay(sender *wsClient, message wireMessage) {
	hub.mu.RLock()
	room := hub.rooms[sender.room]
	if room == nil {
		hub.mu.RUnlock()
		return
	}
	if message.Type == "close_peer" && sender.role == "host" {
		target := room.guests[message.PeerID]
		hub.mu.RUnlock()
		if target != nil {
			_ = target.conn.Close()
		}
		return
	}
	if message.Type != "relay" {
		hub.mu.RUnlock()
		return
	}
	if sender.role == "host" {
		target := room.guests[message.PeerID]
		hub.mu.RUnlock()
		if target != nil {
			_ = target.sendJSON(wireMessage{Type: "relay", PeerID: "host", Data: message.Data})
		}
		return
	}
	host := room.host
	peerID := sender.peerID
	hub.mu.RUnlock()
	if host != nil {
		_ = host.sendJSON(wireMessage{Type: "relay", PeerID: peerID, Data: message.Data})
	}
}

func (hub *relayHub) roomStatus(code string) (bool, map[string]int) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	counts := map[string]int{"pku": 0, "thu": 0}
	room := hub.rooms[code]
	if room == nil || room.host == nil {
		return false, counts
	}
	for _, guest := range room.guests {
		counts[guest.team]++
	}
	return true, counts
}

func (hub *relayHub) activeClients() int {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	total := 0
	for _, room := range hub.rooms {
		if room.host != nil {
			total++
		}
		total += len(room.guests)
	}
	return total
}

func websocketHandler(hub *relayHub, writer http.ResponseWriter, request *http.Request) {
	if !strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
		http.Error(writer, "websocket upgrade required", http.StatusUpgradeRequired)
		return
	}
	key := request.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		http.Error(writer, "missing websocket key", http.StatusBadRequest)
		return
	}
	if origin := request.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || !strings.EqualFold(parsed.Host, request.Host) {
			http.Error(writer, "cross-origin websocket denied", http.StatusForbidden)
			return
		}
	}
	role := request.URL.Query().Get("role")
	room := normalizeCode(request.URL.Query().Get("room"))
	team := request.URL.Query().Get("team")
	if (role != "host" && role != "guest") || len(room) < 8 || (role == "guest" && team != "pku" && team != "thu") {
		http.Error(writer, "invalid room parameters", http.StatusBadRequest)
		return
	}
	hijacker, ok := writer.(http.Hijacker)
	if !ok {
		http.Error(writer, "websocket unavailable", http.StatusInternalServerError)
		return
	}
	conn, buffer, err := hijacker.Hijack()
	if err != nil {
		return
	}
	acceptHash := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	_, _ = fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(acceptHash[:]))
	if buffer.Flush() != nil {
		_ = conn.Close()
		return
	}
	client := &wsClient{conn: conn, reader: buffer.Reader, room: room, role: role, team: team, peerID: randomID(), hub: hub}
	if err := hub.register(client); err != nil {
		_ = client.sendJSON(wireMessage{Type: "error", Message: err.Error()})
		_ = conn.Close()
		return
	}
	hub.announce(client)
	client.readLoop()
}

func normalizeCode(value string) string {
	value = strings.ToUpper(value)
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func randomID() string {
	buffer := make([]byte, 12)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}

func main() {
	port := flag.Int("port", 17890, "HTTP/WebSocket listen port")
	noOpen := flag.Bool("no-open", false, "do not open a browser automatically")
	noUpdate := flag.Bool("no-update", false, "disable automatic updates")
	flag.Parse()

	hub := newRelayHub()
	webRoot, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/info", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"name": "qingbei-local-server", "version": version})
	})
	mux.HandleFunc("/api/room", func(writer http.ResponseWriter, request *http.Request) {
		code := normalizeCode(request.URL.Query().Get("code"))
		online, counts := hub.roomStatus(code)
		players := counts["pku"] + counts["thu"]
		writer.Header().Set("Content-Type", "application/json")
		if !online {
			writer.WriteHeader(http.StatusNotFound)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"online": online, "counts": counts, "players": players})
	})
	mux.HandleFunc("/ws", func(writer http.ResponseWriter, request *http.Request) {
		websocketHandler(hub, writer, request)
	})
	fileServer := http.FileServer(http.FS(webRoot))
	mux.Handle("/qingbei-webgl-campaign/", http.StripPrefix("/qingbei-webgl-campaign/", fileServer))
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, "/qingbei-webgl-campaign/?local=1", http.StatusTemporaryRedirect)
	})

	address := fmt.Sprintf(":%d", *port)
	localURL := fmt.Sprintf("http://127.0.0.1:%d/qingbei-webgl-campaign/?local=1", *port)
	fmt.Printf("解放清华园本地服务器 %s\n", version)
	fmt.Printf("本机管理地址: %s\n", localURL)
	for _, host := range localIPv4Addresses() {
		fmt.Printf("局域网玩家地址: http://%s:%d/qingbei-webgl-campaign/?local=1\n", host, *port)
	}
	fmt.Println("关闭此窗口会停止本地服务器。")
	if !*noOpen {
		go func() {
			time.Sleep(500 * time.Millisecond)
			openBrowser(localURL)
		}()
	}
	if !*noUpdate && version != "dev" {
		go checkForUpdates(hub)
	}
	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(server.ListenAndServe())
}

func localIPv4Addresses() []string {
	var result []string
	interfaces, _ := net.Interfaces()
	for _, item := range interfaces {
		if item.Flags&net.FlagUp == 0 || item.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, _ := item.Addrs()
		for _, address := range addresses {
			ip, _, err := net.ParseCIDR(address.String())
			if err == nil && ip.To4() != nil {
				result = append(result, ip.String())
			}
		}
	}
	return result
}

func openBrowser(url string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	_ = command.Start()
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func checkForUpdates(hub *relayHub) {
	time.Sleep(2 * time.Second)
	client := &http.Client{Timeout: 30 * time.Second}
	request, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/Very12345/qingbei-webgl-campaign/releases/latest", nil)
	request.Header.Set("User-Agent", "qingbei-local-server/"+version)
	response, err := client.Do(request)
	if err != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return
	}
	var release githubRelease
	if json.NewDecoder(response.Body).Decode(&release) != nil || release.TagName == "" || release.TagName == version {
		return
	}
	assetName := fmt.Sprintf("qingbei-server-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		assetName += ".exe"
	}
	var binaryURL, checksumURL string
	for _, asset := range release.Assets {
		if asset.Name == assetName {
			binaryURL = asset.URL
		}
		if asset.Name == assetName+".sha256" {
			checksumURL = asset.URL
		}
	}
	if binaryURL == "" || checksumURL == "" {
		return
	}
	binaryData, err := download(client, binaryURL)
	if err != nil {
		return
	}
	checksumData, err := download(client, checksumURL)
	if err != nil {
		return
	}
	expected := strings.Fields(string(checksumData))
	actual := sha256.Sum256(binaryData)
	if len(expected) == 0 || !strings.EqualFold(expected[0], hex.EncodeToString(actual[:])) {
		log.Println("自动更新校验失败，已取消")
		return
	}
	executable, err := os.Executable()
	if err != nil {
		return
	}
	newPath := executable + ".new"
	if os.WriteFile(newPath, binaryData, 0755) != nil {
		return
	}
	log.Printf("已下载更新 %s，将在房间空闲时自动应用。\n", release.TagName)
	for hub.activeClients() > 0 {
		time.Sleep(10 * time.Second)
	}
	applyUpdate(executable, newPath)
}

func download(client *http.Client, url string) ([]byte, error) {
	request, _ := http.NewRequest(http.MethodGet, url, nil)
	request.Header.Set("User-Agent", "qingbei-local-server/"+version)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 100<<20))
}

func applyUpdate(executable, newPath string) {
	arguments := strings.Join(os.Args[1:], " ")
	if runtime.GOOS == "windows" {
		script := executable + ".update.cmd"
		content := fmt.Sprintf("@echo off\r\ntimeout /t 2 /nobreak >nul\r\nmove /Y \"%s\" \"%s\" >nul\r\nstart \"\" \"%s\" %s\r\ndel \"%%~f0\"\r\n", newPath, executable, executable, arguments)
		if os.WriteFile(script, []byte(content), 0600) == nil {
			_ = exec.Command("cmd", "/C", "start", "", script).Start()
			os.Exit(0)
		}
		return
	}
	script := executable + ".update.sh"
	content := fmt.Sprintf("#!/bin/sh\nsleep 1\nmv -f %q %q\nchmod +x %q\nexec %q %s\n", newPath, executable, executable, executable, arguments)
	if os.WriteFile(script, []byte(content), 0700) == nil {
		_ = exec.Command("sh", script).Start()
		os.Exit(0)
	}
}

func init() {
	log.SetFlags(log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[服务器] ")
}
