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
	conn        net.Conn
	reader      *bufio.Reader
	mu          sync.Mutex
	queueMu     sync.Mutex
	outbound    chan wireMessage
	stateSignal chan struct{}
	latestState *wireMessage
	done        chan struct{}
	doneOnce    sync.Once
	room        string
	role        string
	team        string
	nickname    string
	peerID      string
	hub         *relayHub
}

func (c *wsClient) sendJSON(message wireMessage) error {
	select {
	case <-c.done:
		return errors.New("websocket is closed")
	default:
	}
	if message.Type == "relay" && applicationMessageType(message.Data) == "state_delta" {
		c.queueMu.Lock()
		copy := message
		c.latestState = &copy
		c.queueMu.Unlock()
		select {
		case c.stateSignal <- struct{}{}:
		default:
		}
		return nil
	}
	select {
	case <-c.done:
		return errors.New("websocket is closed")
	case c.outbound <- message:
		return nil
	default:
		log.Printf("连接 %s 的控制队列已满，主动断开慢客户端\n", c.peerID[:8])
		c.shutdown()
		return errors.New("websocket control queue is full")
	}
}

func (c *wsClient) writerLoop() {
	for {
		select {
		case <-c.done:
			return
		case message := <-c.outbound:
			if err := c.writeJSON(message); err != nil {
				log.Printf("连接 %s 写入失败：%v\n", c.peerID[:8], err)
				c.shutdown()
				return
			}
		default:
			select {
			case <-c.done:
				return
			case message := <-c.outbound:
				if err := c.writeJSON(message); err != nil {
					log.Printf("连接 %s 写入失败：%v\n", c.peerID[:8], err)
					c.shutdown()
					return
				}
			case <-c.stateSignal:
				c.queueMu.Lock()
				message := c.latestState
				c.latestState = nil
				c.queueMu.Unlock()
				if message != nil {
					if err := c.writeJSON(*message); err == nil {
						continue
					} else {
						log.Printf("连接 %s 状态写入失败：%v\n", c.peerID[:8], err)
					}
					c.shutdown()
					return
				}
			}
		}
	}
}

func (c *wsClient) writeJSON(message wireMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return c.writeFrame(0x1, payload)
}

func (c *wsClient) shutdown() {
	c.doneOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

func (c *wsClient) writeFrame(opcode byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	writeTimeout := 5 * time.Second
	if c.role == "host" {
		writeTimeout = 30 * time.Second
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	defer c.conn.SetWriteDeadline(time.Time{})
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
		_ = c.conn.Close()
		return err
	}
	_, err := c.conn.Write(payload)
	if err != nil {
		_ = c.conn.Close()
	}
	return err
}

func (c *wsClient) readLoop() {
	defer func() {
		c.hub.unregister(c)
		c.shutdown()
	}()
	var fragmented []byte
	for {
		opcode, final, payload, err := readFrame(c.reader)
		if err != nil {
			select {
			case <-c.done:
			default:
				log.Printf("连接 %s 读取结束：%v\n", c.peerID[:8], err)
			}
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

func applicationMessageType(data string) string {
	var envelope struct {
		Type string `json:"type"`
	}
	if json.Unmarshal([]byte(data), &envelope) != nil {
		return ""
	}
	return envelope.Type
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
	mu     sync.RWMutex
	rooms  map[string]*relayRoom
	chunks map[string]*relayChunk
}

func newRelayHub() *relayHub {
	return &relayHub{
		rooms:  make(map[string]*relayRoom),
		chunks: make(map[string]*relayChunk),
	}
}

type relayChunk struct {
	parts       []string
	received    int
	bytes       int
	created     time.Time
	passthrough bool
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
			_ = guest.writeJSON(wireMessage{Type: "error", Message: "服务器已停止"})
			guest.shutdown()
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
	if message.Type == "server_command_result" && sender.role == "host" {
		terminalCommandResult(message.Message)
		return
	}
	if message.Type == "relay" {
		var complete bool
		message, complete = hub.reassembleRelay(sender, message)
		if !complete {
			return
		}
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
			log.Printf("网页主机请求关闭玩家连接 %s\n", target.peerID[:8])
			target.shutdown()
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

func (hub *relayHub) reassembleRelay(sender *wsClient, message wireMessage) (wireMessage, bool) {
	var chunk struct {
		Type       string `json:"type"`
		TransferID string `json:"transferId"`
		Index      int    `json:"index"`
		Total      int    `json:"total"`
		Data       string `json:"data"`
	}
	if json.Unmarshal([]byte(message.Data), &chunk) != nil || chunk.Type != "network_chunk" {
		return message, true
	}
	if chunk.TransferID == "" || chunk.Total < 1 || chunk.Total > 2_000 || chunk.Index < 0 || chunk.Index >= chunk.Total {
		return message, false
	}
	key := sender.peerID + "|" + message.PeerID + "|" + chunk.TransferID
	hub.mu.Lock()
	for existingKey, transfer := range hub.chunks {
		if time.Since(transfer.created) > 45*time.Second {
			delete(hub.chunks, existingKey)
		}
	}
	transfer := hub.chunks[key]
	if transfer == nil {
		transfer = &relayChunk{
			parts:   make([]string, chunk.Total),
			created: time.Now(),
			passthrough: chunk.Index == 0 &&
				!strings.HasPrefix(chunk.Data, `{"type":"state_delta"`),
		}
		hub.chunks[key] = transfer
	}
	if transfer.passthrough {
		if chunk.Index == chunk.Total-1 {
			delete(hub.chunks, key)
		}
		hub.mu.Unlock()
		return message, true
	}
	if len(transfer.parts) != chunk.Total {
		delete(hub.chunks, key)
		hub.mu.Unlock()
		return message, false
	}
	if transfer.parts[chunk.Index] == "" {
		transfer.parts[chunk.Index] = chunk.Data
		transfer.received++
		transfer.bytes += len(chunk.Data)
	}
	if transfer.bytes > 14<<20 {
		delete(hub.chunks, key)
		hub.mu.Unlock()
		return message, false
	}
	if transfer.received != chunk.Total {
		hub.mu.Unlock()
		return message, false
	}
	message.Data = strings.Join(transfer.parts, "")
	delete(hub.chunks, key)
	hub.mu.Unlock()
	return message, true
}

func (hub *relayHub) sendHostCommand(command string) int {
	command = strings.TrimSpace(command)
	if command == "" {
		return 0
	}
	var hosts []*wsClient
	hub.mu.RLock()
	for _, room := range hub.rooms {
		if room.host != nil {
			hosts = append(hosts, room.host)
		}
	}
	hub.mu.RUnlock()
	for _, host := range hosts {
		_ = host.sendJSON(wireMessage{Type: "server_command", Message: command})
	}
	return len(hosts)
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
	_ = target.writeJSON(wireMessage{Type: "error", Message: "你已被服务器管理员移出"})
	target.shutdown()
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
		client.shutdown()
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
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
		_ = tcp.SetKeepAlive(true)
		_ = tcp.SetKeepAlivePeriod(30 * time.Second)
	}
	acceptHash := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	_, _ = fmt.Fprintf(buffer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(acceptHash[:]))
	if buffer.Flush() != nil {
		_ = conn.Close()
		return
	}
	client := &wsClient{
		conn:        conn,
		reader:      buffer.Reader,
		outbound:    make(chan wireMessage, 512),
		stateSignal: make(chan struct{}, 1),
		done:        make(chan struct{}),
		room:        room,
		role:        role,
		team:        team,
		peerID:      randomID(),
		hub:         hub,
	}
	if err := hub.register(client); err != nil {
		_ = client.writeJSON(wireMessage{Type: "error", Message: err.Error()})
		client.shutdown()
		return
	}
	go client.writerLoop()
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
	noOpen := flag.Bool("no-open", false, "do not start the background battle host")
	noUpdate := flag.Bool("no-update", false, "disable automatic updates")
	flag.Parse()
	if !*noUpdate && version != "dev" {
		checkForUpdates()
	}

	hub := newRelayHub()
	kernelRuntime, err := newJSKernelRuntime()
	if err != nil {
		log.Fatalf("初始化共享JS内核失败: %v", err)
	}
	kernelHealth, err := kernelRuntime.healthCheck()
	if err != nil {
		log.Fatalf("共享JS内核自检失败: %v", err)
	}
	hostURL := fmt.Sprintf("http://127.0.0.1:%d/qingbei-webgl-campaign/?local=1&manage=1&autostart=1", *port)
	var hostController *simulationHostController
	if !*noOpen {
		hostController = newSimulationHostController(hostURL, hub)
	}
	webRoot, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/info", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		info := map[string]any{"name": "qingbei-local-server", "version": version, "kernel": kernelHealth}
		if hostController != nil {
			info["battleHost"] = hostController.snapshot()
		}
		_ = json.NewEncoder(writer).Encode(info)
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
	fileServer := embeddedWebServer(webRoot)
	mux.Handle("/qingbei-webgl-campaign/", http.StripPrefix("/qingbei-webgl-campaign/", fileServer))
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, "/qingbei-webgl-campaign/?local=1", http.StatusTemporaryRedirect)
	})

	address := fmt.Sprintf(":%d", *port)
	playerURL := fmt.Sprintf("http://127.0.0.1:%d/qingbei-webgl-campaign/?local=1", *port)
	printTerminalBanner(version)
	fmt.Printf("%s %s\n", paint(ansiGreen+ansiBold, "本机玩家地址:"), playerURL)
	for _, host := range localIPv4Addresses() {
		fmt.Printf("%s http://%s:%d/qingbei-webgl-campaign/?local=1\n", paint(ansiMagenta+ansiBold, "局域网玩家地址:"), host, *port)
	}
	terminalWarning("关闭此窗口会停止本地服务器。")
	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if hostController != nil {
		hostController.start()
		defer hostController.shutdown()
	}
	go runConsole(hub, server, hostController, kernelRuntime)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func embeddedWebServer(webRoot fs.FS) http.Handler {
	fallback := http.FileServer(http.FS(webRoot))
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		name := strings.TrimPrefix(request.URL.Path, "/")
		if name == "" || strings.HasSuffix(name, "/") {
			name += "index.html"
		}
		name = path.Clean(name)
		if name == "." || strings.HasPrefix(name, "../") {
			http.NotFound(writer, request)
			return
		}
		if _, err := fs.Stat(webRoot, name); err != nil {
			const remoteBase = "https://very12345.github.io/qingbei-webgl-campaign/"
			http.Redirect(writer, request, remoteBase+name, http.StatusTemporaryRedirect)
			return
		}
		if name == "index.html" {
			writer.Header().Set("Cache-Control", "no-cache")
		}
		fallback.ServeHTTP(writer, request)
	})
}

func runConsole(hub *relayHub, server *http.Server, hostController *simulationHostController, kernelRuntime *jsKernelRuntime) {
	fmt.Println()
	terminalSuccess("服务器终端已就绪。输入 help 查看可用命令；支持上下文 API 指令。")
	scanner := bufio.NewScanner(os.Stdin)
	for {
		terminalPrompt()
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
			fmt.Println(paint(ansiYellow+ansiBold, "服务器与玩家"))
			fmt.Println("  status / battle       查看进程或详细战局状态")
			fmt.Println("  host / host restart   查看或重启后台战局主机")
			fmt.Println("  kernel                查看共享JS内核状态")
			fmt.Println("  ai <pku|thu>          查看AI生产点和当前战略路线")
			fmt.Println("  rooms / players       查看战局和在线玩家")
			fmt.Println("  kick <名称/ID>        移出玩家")
			fmt.Println("  say <消息>            广播系统消息")
			fmt.Println(paint(ansiYellow+ansiBold, "战局与存档"))
			fmt.Println("  save                  立即保存")
			fmt.Println("  new                   创建全新战局")
			fmt.Println("  saves                 列出服务器存档")
			fmt.Println("  resume [名称/ID]      恢复指定或最近战局")
			fmt.Println("  maps / map <编号>     列出或切换地图存档")
			fmt.Println("  logs [数量]           查看战局记录")
			fmt.Println(paint(ansiYellow+ansiBold, "配置与管理"))
			fmt.Println("  config                查看全部配置")
			fmt.Println("  set name <名称>       修改服务器名称")
			fmt.Println("  set maxplayers <2-8>  修改最大玩家数")
			fmt.Println("  set sameteam <on|off> 允许或禁止后续玩家同阵营")
			fmt.Println("  set turn-url <地址>   配置TURN中继（可逗号分隔）")
			fmt.Println("  set turn-user <名称>  配置TURN用户名")
			fmt.Println("  set turn-credential   配置TURN凭据")
			fmt.Println("  timescale <0.5-16>    修改时间倍率")
			fmt.Println("  resource <阵营> <数>  修改战略资源")
			fmt.Println("  mobilize <阵营> <姿态>执行总动员")
			fmt.Println("  version / clear / stop")
			fmt.Println(paint(ansiDim, "未被终端内建处理的命令会自动转发给战局 API。"))
		case "status":
			rooms := hub.consoleSnapshot()
			players := 0
			for _, room := range rooms {
				players += len(room.players)
			}
			fmt.Printf("%s %s  %s %d  %s %d\n", paint(ansiCyan, "版本"), paint(ansiWhite+ansiBold, version), paint(ansiCyan, "运行中战局"), len(rooms), paint(ansiCyan, "在线玩家"), players)
		case "host":
			if hostController == nil {
				terminalWarning("后台战局主机已通过 --no-open 禁用。")
				continue
			}
			if strings.EqualFold(strings.TrimSpace(argument), "restart") {
				hostController.requestRestart()
				terminalInfo("已请求重启后台战局主机。")
				continue
			}
			snapshot := hostController.snapshot()
			fmt.Printf("%s %s\n", paint(ansiCyan, "后台状态:"), paint(ansiWhite+ansiBold, snapshot.Status))
			fmt.Printf("%s %d\n", paint(ansiCyan, "自动重启:"), snapshot.Restarts)
			if snapshot.Error != "" {
				terminalError("最近错误: " + snapshot.Error)
			}
		case "kernel":
			health, err := kernelRuntime.healthCheck()
			if err != nil {
				terminalError("共享JS内核错误: " + err.Error())
				continue
			}
			encoded, _ := json.Marshal(health)
			fmt.Printf("%s %s\n", paint(ansiCyan, "共享JS内核:"), paint(ansiWhite+ansiBold, string(encoded)))
		case "rooms":
			rooms := hub.consoleSnapshot()
			if len(rooms) == 0 {
				terminalWarning("后台战局主机仍在初始化，请稍后重试。")
				continue
			}
			for _, room := range rooms {
				state := "等待网页主机"
				if room.host {
					state = "运行中"
				}
				fmt.Printf("%s  %s  %s\n", paint(ansiMagenta+ansiBold, room.code), paint(ansiGreen, state), paint(ansiWhite, fmt.Sprintf("%d 名玩家", len(room.players))))
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
				terminalInfo("当前没有在线玩家。")
			}
		case "say":
			if strings.TrimSpace(argument) == "" {
				terminalWarning("用法：say <消息>")
				continue
			}
			deliveries := hub.broadcastSystemMessage(argument)
			log.Printf("[公告] %s（发送 %d 个连接）\n", strings.TrimSpace(argument), deliveries)
		case "save", "new", "resume":
			if hub.sendHostCommand(line) == 0 {
				terminalWarning("后台战局主机尚未就绪，请稍后重试。")
			} else {
				terminalSuccess("命令已发送。")
			}
		case "battle":
			if hub.sendHostCommand("status") == 0 {
				terminalWarning("后台战局主机尚未就绪，请稍后重试。")
			} else {
				terminalInfo("正在读取战局状态...")
			}
		case "kick":
			if hub.kickPlayer(argument) {
				terminalSuccess("已移出玩家。")
			} else {
				terminalWarning("未找到玩家。请使用 players 查看名称或ID。")
			}
		case "version":
			fmt.Printf("解放清华园本地服务器 %s\n", version)
		case "clear", "cls":
			clearConsole()
		case "stop", "exit", "quit":
			terminalWarning("正在保存战局、断开玩家并停止服务器...")
			if hub.sendHostCommand("save") > 0 {
				time.Sleep(350 * time.Millisecond)
			}
			hub.broadcastSystemMessage("服务器正在停止")
			hub.closeAll()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = server.Shutdown(ctx)
			cancel()
			return
		default:
			if hub.sendHostCommand(line) == 0 {
				terminalWarning("后台战局主机尚未就绪；命令暂未发送。")
			} else {
				terminalInfo("API 命令已发送。")
			}
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
	metadataTransport := http.DefaultTransport.(*http.Transport).Clone()
	metadataTransport.ResponseHeaderTimeout = 25 * time.Second
	metadataTransport.TLSHandshakeTimeout = 20 * time.Second
	metadataClient := &http.Client{
		Timeout:   40 * time.Second,
		Transport: metadataTransport,
	}
	latestVersion, err := discoverLatestVersion(metadataClient)
	if err != nil {
		fmt.Printf("更新检查失败：%v，将继续启动当前版本。\n", err)
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
	pagesBase := fmt.Sprintf(
		"https://very12345.github.io/qingbei-webgl-campaign/downloads/%s/",
		url.PathEscape(latestVersion),
	)
	downloadTransport := http.DefaultTransport.(*http.Transport).Clone()
	downloadTransport.ResponseHeaderTimeout = 45 * time.Second
	downloadTransport.TLSHandshakeTimeout = 30 * time.Second
	downloadTransport.IdleConnTimeout = 90 * time.Second
	downloadClient := &http.Client{
		Timeout:   4 * time.Minute,
		Transport: downloadTransport,
	}
	binaryData, sourceName, err := downloadVerifiedUpdate(
		downloadClient,
		assetName,
		[]updateSource{
			{name: "GitHub Release", baseURL: releaseBase, attempts: 1},
			{name: "GitHub Pages CDN", baseURL: pagesBase, attempts: 3},
		},
	)
	if err != nil {
		fmt.Printf("所有更新下载源均失败：%v，将继续启动当前版本。\n", err)
		return
	}
	fmt.Printf("更新文件校验完成（来源：%s）。\n", sourceName)
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

type updateSource struct {
	name     string
	baseURL  string
	attempts int
}

func discoverLatestVersion(client *http.Client) (string, error) {
	request, _ := http.NewRequest(http.MethodHead, "https://github.com/Very12345/qingbei-webgl-campaign/releases/latest", nil)
	request.Header.Set("User-Agent", "qingbei-local-server/"+version)
	response, githubErr := client.Do(request)
	if githubErr == nil {
		defer response.Body.Close()
		if response.StatusCode == http.StatusOK {
			latestVersion, err := url.PathUnescape(path.Base(response.Request.URL.Path))
			if err == nil && latestVersion != "" && latestVersion != "latest" {
				return latestVersion, nil
			}
		}
		githubErr = fmt.Errorf("GitHub 返回 %s", response.Status)
	}
	fmt.Printf("GitHub版本检查失败：%v，正在尝试Pages CDN...\n", githubErr)
	data, pagesErr := download(
		client,
		"https://very12345.github.io/qingbei-webgl-campaign/VERSION",
	)
	if pagesErr != nil {
		return "", fmt.Errorf("GitHub: %v；Pages CDN: %v", githubErr, pagesErr)
	}
	latestVersion := strings.TrimSpace(string(data))
	if !strings.HasPrefix(latestVersion, "v") || len(latestVersion) > 32 {
		return "", errors.New("Pages CDN返回了无效版本号")
	}
	return latestVersion, nil
}

func downloadVerifiedUpdate(
	client *http.Client,
	assetName string,
	sources []updateSource,
) ([]byte, string, error) {
	var lastErr error
	for _, source := range sources {
		attempts := max(1, source.attempts)
		for attempt := 1; attempt <= attempts; attempt++ {
			fmt.Printf("正在使用%s下载（第%d/%d次）...\n", source.name, attempt, attempts)
			binaryURL := source.baseURL + url.PathEscape(assetName)
			checksumData, err := download(client, binaryURL+".sha256")
			if err != nil {
				lastErr = fmt.Errorf("%s校验文件：%w", source.name, err)
				fmt.Printf("%v\n", lastErr)
			} else {
				binaryData, binaryErr := downloadWithProgress(client, binaryURL)
				if binaryErr != nil {
					lastErr = fmt.Errorf("%s安装包：%w", source.name, binaryErr)
					fmt.Printf("%v\n", lastErr)
				} else {
					fmt.Println("正在校验更新文件...")
					expected := strings.Fields(string(checksumData))
					actual := sha256.Sum256(binaryData)
					if len(expected) > 0 && strings.EqualFold(expected[0], hex.EncodeToString(actual[:])) {
						return binaryData, source.name, nil
					}
					lastErr = fmt.Errorf("%s文件SHA-256校验失败", source.name)
					fmt.Printf("%v\n", lastErr)
				}
			}
			if attempt < attempts {
				time.Sleep(time.Duration(attempt*2) * time.Second)
			}
		}
	}
	if lastErr == nil {
		lastErr = errors.New("没有可用的更新下载源")
	}
	return nil, "", lastErr
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
		content := fmt.Sprintf("@echo off\r\nping 127.0.0.1 -n 3 >nul\r\nmove /Y \"%s\" \"%s\" >nul\r\nstart \"\" /B \"%s\" %s\r\n(goto) 2>nul & del \"%%~f0\"\r\n", newPath, executable, executable, arguments)
		if err := os.WriteFile(script, []byte(content), 0600); err != nil {
			return err
		}
		if err := exec.Command("cmd", "/D", "/C", "call", script).Start(); err != nil {
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
