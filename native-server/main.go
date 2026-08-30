package main

import (
	"bufio"
	"bytes"
	"context"
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
	"path"
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
	conn     net.Conn
	reader   *bufio.Reader
	mu       sync.Mutex
	room     string
	role     string
	team     string
	nickname string
	peerID   string
	hub      *relayHub
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
		log.Printf("房间 %s 已启动\n", client.room)
		return nil
	}
	if room.host == nil {
		return errors.New("room host is offline")
	}
	room.guests[client.peerID] = client
	log.Printf("玩家 %s 正在连接房间 %s（%s）\n", client.peerID[:8], client.room, teamName(client.team))
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
		log.Printf("房间 %s 已停止\n", client.room)
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
	name := client.nickname
	if name == "" {
		name = client.peerID[:8]
	}
	log.Printf("玩家 %s 已离开房间 %s\n", name, client.room)
	if host != nil {
		_ = host.sendJSON(wireMessage{Type: "peer_leave", PeerID: client.peerID})
	}
}

func (hub *relayHub) relay(sender *wsClient, message wireMessage) {
	if message.Type == "relay" {
		hub.observeRelay(sender, message.Data)
	}
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

func (hub *relayHub) observeRelay(sender *wsClient, data string) {
	var envelope struct {
		Type     string `json:"type"`
		Channel  string `json:"channel"`
		Text     string `json:"text"`
		Identity struct {
			Nickname string `json:"nickname"`
			Team     string `json:"team"`
		} `json:"identity"`
	}
	if json.Unmarshal([]byte(data), &envelope) != nil {
		return
	}
	switch envelope.Type {
	case "hello":
		name := strings.TrimSpace(envelope.Identity.Nickname)
		if len([]rune(name)) > 16 {
			name = string([]rune(name)[:16])
		}
		hub.mu.Lock()
		sender.nickname = name
		hub.mu.Unlock()
		if name != "" {
			log.Printf("玩家 %s 已进入房间 %s（%s）\n", name, sender.room, teamName(sender.team))
		}
	case "chat_send":
		text := strings.TrimSpace(envelope.Text)
		if text == "" {
			return
		}
		name := sender.nickname
		if name == "" {
			name = sender.peerID[:8]
		}
		log.Printf("[聊天/%s] %s: %s\n", envelope.Channel, name, text)
	}
}

func teamName(team string) string {
	if team == "pku" {
		return "北大"
	}
	if team == "thu" {
		return "清华"
	}
	return "未选择"
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

func (hub *relayHub) activeRoomStatus() (string, bool, map[string]int) {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	counts := map[string]int{"pku": 0, "thu": 0}
	for code, room := range hub.rooms {
		if room.host == nil {
			continue
		}
		for _, guest := range room.guests {
			counts[guest.team]++
		}
		return code, true, counts
	}
	return "", false, counts
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

type consoleRoom struct {
	code    string
	host    bool
	players []consolePlayer
}

type consolePlayer struct {
	id       string
	nickname string
	team     string
}

func (hub *relayHub) consoleSnapshot() []consoleRoom {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	rooms := make([]consoleRoom, 0, len(hub.rooms))
	for code, room := range hub.rooms {
		summary := consoleRoom{code: code, host: room.host != nil}
		for _, guest := range room.guests {
			summary.players = append(summary.players, consolePlayer{
				id:       guest.peerID,
				nickname: guest.nickname,
				team:     guest.team,
			})
		}
		rooms = append(rooms, summary)
	}
	return rooms
}

func (hub *relayHub) broadcastSystemMessage(text string) int {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	runes := []rune(text)
	if len(runes) > 200 {
		text = string(runes[:200])
	}
	payload, _ := json.Marshal(map[string]any{
		"type": "chat_message",
		"message": map[string]any{
			"id":         "server-" + randomID(),
			"senderId":   "server-console",
			"senderName": "服务器",
			"senderTeam": "pku",
			"channel":    "system",
			"text":       text,
			"sentAt":     time.Now().UnixMilli(),
		},
	})
	type delivery struct {
		client *wsClient
		peerID string
	}
	var deliveries []delivery
	hub.mu.RLock()
	for _, room := range hub.rooms {
		for peerID, guest := range room.guests {
			if room.host != nil {
				deliveries = append(deliveries, delivery{client: room.host, peerID: peerID})
			}
			deliveries = append(deliveries, delivery{client: guest, peerID: "host"})
		}
	}
	hub.mu.RUnlock()
	for _, item := range deliveries {
		_ = item.client.sendJSON(wireMessage{Type: "relay", PeerID: item.peerID, Data: string(payload)})
	}
	return len(deliveries)
}

func (hub *relayHub) kickPlayer(query string) bool {
	query = strings.TrimSpace(query)
	if query == "" {
		return false
	}
	var target *wsClient
	hub.mu.RLock()
	for _, room := range hub.rooms {
		for _, guest := range room.guests {
			if strings.HasPrefix(guest.peerID, query) || strings.EqualFold(guest.nickname, query) {
				target = guest
				break
			}
		}
		if target != nil {
			break
		}
	}
	hub.mu.RUnlock()
	if target == nil {
		return false
	}
	_ = target.sendJSON(wireMessage{Type: "error", Message: "你已被服务器管理员移出"})
	_ = target.conn.Close()
	return true
}

func (hub *relayHub) closeAll() {
	var clients []*wsClient
	hub.mu.RLock()
	for _, room := range hub.rooms {
		if room.host != nil {
			clients = append(clients, room.host)
		}
		for _, guest := range room.guests {
			clients = append(clients, guest)
		}
	}
	hub.mu.RUnlock()
	for _, client := range clients {
		_ = client.conn.Close()
	}
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
	if !*noUpdate && version != "dev" {
		checkForUpdates()
	}

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
		var online bool
		var counts map[string]int
		if code == "" {
			code, online, counts = hub.activeRoomStatus()
		} else {
			online, counts = hub.roomStatus(code)
		}
		players := counts["pku"] + counts["thu"]
		writer.Header().Set("Content-Type", "application/json")
		if !online {
			writer.WriteHeader(http.StatusNotFound)
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"online": online, "roomCode": code, "counts": counts, "players": players})
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
	localURL := fmt.Sprintf("http://127.0.0.1:%d/qingbei-webgl-campaign/?local=1&manage=1", *port)
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
	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go runConsole(hub, server)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func runConsole(hub *relayHub, server *http.Server) {
	fmt.Println()
	fmt.Println("服务器终端已就绪。输入 help 查看可用命令。")
	scanner := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		if !scanner.Scan() {
			return
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		command, argument, _ := strings.Cut(line, " ")
		switch strings.ToLower(command) {
		case "help", "?":
			fmt.Println("可用命令：")
			fmt.Println("  status          查看服务器、房间和玩家数量")
			fmt.Println("  rooms           查看正在运行的战局")
			fmt.Println("  players         查看所有在线玩家")
			fmt.Println("  say <消息>      向所有战局发送系统消息")
			fmt.Println("  kick <名称/ID>  移出一名玩家")
			fmt.Println("  version         查看服务器版本")
			fmt.Println("  clear           清空终端")
			fmt.Println("  stop            保存由网页负责；断开玩家并停止服务")
		case "status":
			rooms := hub.consoleSnapshot()
			players := 0
			for _, room := range rooms {
				players += len(room.players)
			}
			fmt.Printf("版本 %s · 运行中战局 %d · 在线玩家 %d\n", version, len(rooms), players)
		case "rooms":
			rooms := hub.consoleSnapshot()
			if len(rooms) == 0 {
				fmt.Println("当前没有运行中的战局。请在本机管理页面创建并启动服务器。")
				continue
			}
			for _, room := range rooms {
				state := "等待网页主机"
				if room.host {
					state = "运行中"
				}
				fmt.Printf("%s · %s · %d 名玩家\n", room.code, state, len(room.players))
			}
		case "players":
			rooms := hub.consoleSnapshot()
			shown := 0
			for _, room := range rooms {
				for _, player := range room.players {
					name := player.nickname
					if name == "" {
						name = "（正在进入）"
					}
					fmt.Printf("%s · %s · %s · 房间 %s\n", player.id[:8], name, teamName(player.team), room.code)
					shown++
				}
			}
			if shown == 0 {
				fmt.Println("当前没有在线玩家。")
			}
		case "say":
			if strings.TrimSpace(argument) == "" {
				fmt.Println("用法：say <消息>")
				continue
			}
			deliveries := hub.broadcastSystemMessage(argument)
			log.Printf("[公告] %s（发送 %d 个连接）\n", strings.TrimSpace(argument), deliveries)
		case "kick":
			if hub.kickPlayer(argument) {
				fmt.Println("已移出玩家。")
			} else {
				fmt.Println("未找到玩家。请使用 players 查看名称或ID。")
			}
		case "version":
			fmt.Printf("解放清华园本地服务器 %s\n", version)
		case "clear", "cls":
			clearConsole()
		case "stop", "exit", "quit":
			fmt.Println("正在断开玩家并停止服务器...")
			hub.broadcastSystemMessage("服务器正在停止")
			hub.closeAll()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = server.Shutdown(ctx)
			cancel()
			return
		default:
			fmt.Printf("未知命令：%s。输入 help 查看命令。\n", command)
		}
	}
}

func clearConsole() {
	if runtime.GOOS == "windows" {
		command := exec.Command("cmd", "/C", "cls")
		command.Stdout = os.Stdout
		_ = command.Run()
		return
	}
	fmt.Print("\033[H\033[2J")
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

func checkForUpdates() {
	fmt.Printf("正在检查更新（当前版本 %s）...\n", version)
	client := &http.Client{Timeout: 30 * time.Second}
	request, _ := http.NewRequest(http.MethodHead, "https://github.com/Very12345/qingbei-webgl-campaign/releases/latest", nil)
	request.Header.Set("User-Agent", "qingbei-local-server/"+version)
	response, err := client.Do(request)
	if err != nil {
		fmt.Printf("更新检查失败：%v，将继续启动当前版本。\n", err)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fmt.Printf("更新检查失败：GitHub 返回 %s，将继续启动当前版本。\n", response.Status)
		return
	}
	latestVersion, err := url.PathUnescape(path.Base(response.Request.URL.Path))
	if err != nil || latestVersion == "" || latestVersion == "latest" {
		fmt.Println("更新信息无法读取，将继续启动当前版本。")
		return
	}
	if latestVersion == version {
		fmt.Println("当前已是最新版本。")
		return
	}
	fmt.Printf("发现更新：%s → %s\n", version, latestVersion)
	assetName := fmt.Sprintf("qingbei-server-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		assetName += ".exe"
	}
	releaseBase := fmt.Sprintf(
		"https://github.com/Very12345/qingbei-webgl-campaign/releases/download/%s/",
		url.PathEscape(latestVersion),
	)
	binaryURL := releaseBase + url.PathEscape(assetName)
	checksumURL := binaryURL + ".sha256"
	binaryData, err := downloadWithProgress(client, binaryURL)
	if err != nil {
		fmt.Printf("更新下载失败：%v，将继续启动当前版本。\n", err)
		return
	}
	checksumData, err := download(client, checksumURL)
	if err != nil {
		fmt.Printf("校验文件下载失败：%v，将继续启动当前版本。\n", err)
		return
	}
	fmt.Println("正在校验更新文件...")
	expected := strings.Fields(string(checksumData))
	actual := sha256.Sum256(binaryData)
	if len(expected) == 0 || !strings.EqualFold(expected[0], hex.EncodeToString(actual[:])) {
		fmt.Println("更新文件校验失败，已取消安装并继续启动当前版本。")
		return
	}
	fmt.Println("更新文件校验完成。")
	executable, err := os.Executable()
	if err != nil {
		fmt.Printf("无法确定服务器程序位置：%v，将继续启动当前版本。\n", err)
		return
	}
	newPath := executable + ".new"
	if err := os.WriteFile(newPath, binaryData, 0755); err != nil {
		fmt.Printf("无法写入更新文件：%v，将继续启动当前版本。\n", err)
		return
	}
	fmt.Println("正在安装更新...服务器将自动重新启动。")
	if err := applyUpdate(executable, newPath); err != nil {
		fmt.Printf("更新安装失败：%v，将继续启动当前版本。\n", err)
	}
}

func downloadWithProgress(client *http.Client, url string) ([]byte, error) {
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
	if response.ContentLength > 100<<20 {
		return nil, errors.New("update exceeds 100 MiB limit")
	}
	var buffer bytes.Buffer
	if response.ContentLength > 0 {
		buffer.Grow(int(response.ContentLength))
	}
	chunk := make([]byte, 64<<10)
	var downloaded int64
	lastPercent := -1
	fmt.Print("下载更新：0%")
	for {
		count, readErr := response.Body.Read(chunk)
		if count > 0 {
			downloaded += int64(count)
			if downloaded > 100<<20 {
				fmt.Println()
				return nil, errors.New("update exceeds 100 MiB limit")
			}
			_, _ = buffer.Write(chunk[:count])
			if response.ContentLength > 0 {
				percent := int(downloaded * 100 / response.ContentLength)
				if percent != lastPercent {
					fmt.Printf("\r下载更新：%d%%", percent)
					lastPercent = percent
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			fmt.Println()
			return nil, readErr
		}
	}
	if response.ContentLength <= 0 {
		fmt.Printf("\r下载更新：%.1f MiB", float64(downloaded)/(1<<20))
	} else if lastPercent < 100 {
		fmt.Print("\r下载更新：100%")
	}
	fmt.Println()
	return buffer.Bytes(), nil
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

func applyUpdate(executable, newPath string) error {
	arguments := strings.Join(os.Args[1:], " ")
	if runtime.GOOS == "windows" {
		script := executable + ".update.cmd"
		content := fmt.Sprintf("@echo off\r\ntimeout /t 2 /nobreak >nul\r\nmove /Y \"%s\" \"%s\" >nul\r\nstart \"\" \"%s\" %s\r\ndel \"%%~f0\"\r\n", newPath, executable, executable, arguments)
		if err := os.WriteFile(script, []byte(content), 0600); err != nil {
			return err
		}
		if err := exec.Command("cmd", "/C", "start", "", script).Start(); err != nil {
			return err
		}
		os.Exit(0)
	}
	script := executable + ".update.sh"
	content := fmt.Sprintf("#!/bin/sh\nsleep 1\nmv -f %q %q\nchmod +x %q\nexec %q %s\n", newPath, executable, executable, executable, arguments)
	if err := os.WriteFile(script, []byte(content), 0700); err != nil {
		return err
	}
	if err := exec.Command("sh", script).Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

func init() {
	log.SetFlags(log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[服务器] ")
}
