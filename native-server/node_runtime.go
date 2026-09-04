package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

//go:embed node_runtime.cjs
var nodeBootstrap string

type nodeWorker struct {
	command   *exec.Cmd
	input     io.WriteCloser
	output    *bufio.Scanner
	done      chan struct{}
	closed    chan struct{}
	closeOnce sync.Once
}

var nodeProcesses = struct {
	sync.Mutex
	pids       map[int]bool
	lastCPU    map[int]float64
	retiredCPU float64
}{pids: map[int]bool{}, lastCPU: map[int]float64{}}

func startNodeWorker() (*nodeWorker, error) {
	path := os.Getenv("QINGBEI_NODE_PATH")
	if path == "" {
		var err error
		path, err = exec.LookPath("node")
		if err != nil {
			return nil, err
		}
	}
	command := exec.Command(path, "--max-old-space-size=256", "-e", nodeBootstrap)
	hideNodeWindow(command)
	input, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		return nil, err
	}
	w := &nodeWorker{command: command, input: input, output: bufio.NewScanner(output), done: make(chan struct{}), closed: make(chan struct{})}
	w.output.Buffer(make([]byte, 64<<10), 32<<20)
	nodeProcesses.Lock()
	nodeProcesses.pids[command.Process.Pid] = true
	nodeProcesses.Unlock()
	go func() {
		_ = command.Wait()
		nodeProcesses.Lock()
		delete(nodeProcesses.pids, command.Process.Pid)
		if command.ProcessState != nil {
			nodeProcesses.retiredCPU += max(nodeProcesses.lastCPU[command.Process.Pid], command.ProcessState.UserTime().Seconds()+command.ProcessState.SystemTime().Seconds())
		}
		delete(nodeProcesses.lastCPU, command.Process.Pid)
		nodeProcesses.Unlock()
		close(w.done)
	}()
	if _, err = w.request(map[string]any{"op": "init", "bundle": kernelBundle}); err != nil {
		w.close()
		return nil, err
	}
	return w, nil
}

// Calls are serialized by the runtime mutex. A wedged worker is bounded and
// killed; it never silently changes an in-progress game to another engine.
func (w *nodeWorker) request(request any) (json.RawMessage, error) {
	select {
	case <-w.closed:
		return nil, errors.New("Node kernel closed")
	case <-w.done:
		return nil, errors.New("Node kernel exited")
	default:
	}
	type response struct {
		data json.RawMessage
		err  error
	}
	result := make(chan response, 1)
	go func() {
		encoded, err := json.Marshal(request)
		if err != nil {
			result <- response{err: err}
			return
		}
		if _, err = w.input.Write(append(encoded, '\n')); err != nil {
			result <- response{err: err}
			return
		}
		if !w.output.Scan() {
			err = w.output.Err()
			if err == nil {
				err = io.EOF
			}
			result <- response{err: err}
			return
		}
		var reply struct {
			Result json.RawMessage `json:"result"`
			Error  string          `json:"error"`
		}
		if err = json.Unmarshal(w.output.Bytes(), &reply); err == nil && reply.Error != "" {
			err = fmt.Errorf("Node kernel: %s", reply.Error)
		}
		result <- response{reply.Result, err}
	}()
	select {
	case reply := <-result:
		return reply.data, reply.err
	case <-time.After(10 * time.Second):
		w.close()
		return nil, errors.New("Node kernel response timed out")
	}
}
func (w *nodeWorker) close() {
	w.closeOnce.Do(func() {
		close(w.closed)
		_ = w.input.Close()
		select {
		case <-w.done:
			return
		case <-time.After(300 * time.Millisecond):
			_ = w.command.Process.Kill()
		}
	})
}
func (runtime *jsKernelRuntime) close() {
	if runtime.node != nil {
		runtime.node.close()
	}
}
func (instance *jsKernelInstance) dispose() {
	if instance == nil || instance.runtime.node == nil {
		return
	}
	instance.runtime.mu.Lock()
	defer instance.runtime.mu.Unlock()
	_, _ = instance.runtime.node.request(map[string]any{"op": "dispose", "instance": instance.nodeID})
}
