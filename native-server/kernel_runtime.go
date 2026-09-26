package main

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

// kernelBundle is generated from src/game/kernel/index.ts. The browser,
// benchmark runner and native server all execute this exact bundle/API.
//
//go:embed kernel_bundle.js
var kernelBundle string

//go:embed kernel_seed.json.gz
var kernelSeed []byte

type jsKernelRuntime struct {
	node    *nodeWorker
	engine  string
	mu      sync.Mutex
	vm      *goja.Runtime
	exports *goja.Object
}

type jsKernelInstance struct {
	nodeID  int
	runtime *jsKernelRuntime
	object  *goja.Object
}

func newJSKernelRuntime() (*jsKernelRuntime, error) {
	engine := strings.ToLower(strings.TrimSpace(os.Getenv("QINGBEI_KERNEL_ENGINE")))
	if engine != "" && engine != "goja" && engine != "node" {
		return nil, fmt.Errorf("unsupported kernel engine %q", engine)
	}
	if engine == "node" {
		worker, err := startNodeWorker()
		if err != nil {
			return nil, fmt.Errorf("start Node kernel: %w", err)
		}
		return &jsKernelRuntime{node: worker, engine: "node"}, nil
	}
	vm := goja.New()
	if _, err := vm.RunString(kernelBundle); err != nil {
		return nil, fmt.Errorf("load embedded JS kernel: %w", err)
	}
	exports := vm.Get("QingbeiKernel")
	if goja.IsUndefined(exports) || goja.IsNull(exports) {
		return nil, fmt.Errorf("embedded JS kernel did not expose QingbeiKernel")
	}
	return &jsKernelRuntime{vm: vm, exports: exports.ToObject(vm), engine: "goja"}, nil
}

func loadKernelSeed() (map[string]any, map[string]any, error) {
	reader, err := gzip.NewReader(bytes.NewReader(kernelSeed))
	if err != nil {
		return nil, nil, fmt.Errorf("open embedded kernel seed: %w", err)
	}
	defer reader.Close()
	var payload struct {
		State   map[string]any
		NavGrid map[string]any
	}
	if err := json.NewDecoder(reader).Decode(&payload); err != nil {
		return nil, nil, fmt.Errorf("decode embedded kernel seed: %w", err)
	}
	return payload.State, payload.NavGrid, nil
}

func (runtime *jsKernelRuntime) call(name string, arguments ...any) (goja.Value, error) {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	function, ok := goja.AssertFunction(runtime.exports.Get(name))
	if !ok {
		return nil, fmt.Errorf("JS kernel export %q is not callable", name)
	}
	values := make([]goja.Value, 0, len(arguments))
	for _, argument := range arguments {
		values = append(values, runtime.vm.ToValue(argument))
	}
	value, err := function(goja.Undefined(), values...)
	if err != nil {
		return nil, fmt.Errorf("call JS kernel %s: %w", name, err)
	}
	return value, nil
}

func (runtime *jsKernelRuntime) healthCheck() (map[string]any, error) {
	if runtime.node != nil {
		runtime.mu.Lock()
		defer runtime.mu.Unlock()
		data, err := runtime.node.request(map[string]any{"op": "health"})
		if err != nil {
			return nil, err
		}
		var result map[string]any
		err = json.Unmarshal(data, &result)
		if err != nil {
			return nil, err
		}
		result["engine"] = "node"
		return result, nil
	}
	value, err := runtime.call("healthCheck")
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value.Export())
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	result["engine"] = "goja"
	return result, nil
}

func (runtime *jsKernelRuntime) create(initialState any, options ...any) (*jsKernelInstance, error) {
	arguments := []any{initialState}
	arguments = append(arguments, options...)
	if runtime.node != nil {
		runtime.mu.Lock()
		defer runtime.mu.Unlock()
		data, err := runtime.node.request(map[string]any{"op": "create", "args": arguments})
		if err != nil {
			return nil, err
		}
		var result struct{ ID int }
		if err = json.Unmarshal(data, &result); err != nil {
			return nil, err
		}
		return &jsKernelInstance{runtime: runtime, nodeID: result.ID}, nil
	}
	value, err := runtime.call("createKernel", arguments...)
	if err != nil {
		return nil, err
	}
	return &jsKernelInstance{runtime: runtime, object: value.ToObject(runtime.vm)}, nil
}

func (instance *jsKernelInstance) call(name string, arguments ...any) (map[string]any, error) {
	instance.runtime.mu.Lock()
	defer instance.runtime.mu.Unlock()
	if instance.runtime.node != nil {
		data, err := instance.runtime.node.request(map[string]any{"op": "call", "instance": instance.nodeID, "method": name, "args": arguments})
		if err != nil {
			return nil, err
		}
		if string(data) == "null" {
			return map[string]any{}, nil
		}
		var result map[string]any
		err = json.Unmarshal(data, &result)
		return result, err
	}
	function, ok := goja.AssertFunction(instance.object.Get(name))
	if !ok {
		return nil, fmt.Errorf("JS kernel instance method %q is not callable", name)
	}
	values := make([]goja.Value, 0, len(arguments))
	for _, argument := range arguments {
		values = append(values, instance.runtime.vm.ToValue(argument))
	}
	value, err := function(instance.object, values...)
	if err != nil {
		return nil, fmt.Errorf("call JS kernel instance %s: %w", name, err)
	}
	if goja.IsUndefined(value) || goja.IsNull(value) {
		return map[string]any{}, nil
	}
	encoded, err := json.Marshal(value.Export())
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (instance *jsKernelInstance) dispatch(action any) error {
	_, err := instance.call("dispatch", action)
	return err
}

func (instance *jsKernelInstance) step(realMilliseconds float64) (map[string]any, error) {
	return instance.call("step", realMilliseconds)
}

func (instance *jsKernelInstance) advanceOnly(realMilliseconds float64) error {
	_, err := instance.call("advanceOnly", realMilliseconds)
	return err
}

func (instance *jsKernelInstance) run(iterations int, realMilliseconds float64) (map[string]any, error) {
	return instance.call("run", iterations, realMilliseconds)
}

func (instance *jsKernelInstance) snapshot() (map[string]any, error) {
	return instance.call("snapshot")
}

func (instance *jsKernelInstance) networkFull() (map[string]any, error) {
	return instance.call("networkFull")
}

func (instance *jsKernelInstance) networkDelta() (map[string]any, error) {
	return instance.call("networkDelta")
}

// Keep the numeric delta in JSON instead of recursively exporting every JS
// array into Go values, re-encoding and decoding it again.
func (instance *jsKernelInstance) networkDeltaJSON() (string, error) {
	instance.runtime.mu.Lock()
	defer instance.runtime.mu.Unlock()
	if instance.runtime.node != nil {
		data, err := instance.runtime.node.request(map[string]any{"op": "call", "instance": instance.nodeID, "method": "networkDeltaJSON"})
		if err != nil {
			return "", err
		}
		var result string
		err = json.Unmarshal(data, &result)
		return result, err
	}
	fn, ok := goja.AssertFunction(instance.object.Get("networkDeltaJSON"))
	if !ok {
		return "", fmt.Errorf("kernel lacks networkDeltaJSON")
	}
	value, err := fn(instance.object)
	if err != nil {
		return "", err
	}
	return value.String(), nil
}
