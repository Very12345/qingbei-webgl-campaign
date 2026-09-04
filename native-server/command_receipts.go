package main

import "time"

type commandReceipt struct {
	client   *wsClient
	revision int
	queuedAt time.Time
}

func allowCommandRate(client *wsClient) bool {
	client.rateMu.Lock()
	defer client.rateMu.Unlock()
	now := time.Now()
	if now.Sub(client.commandWindow) >= time.Second {
		client.commandWindow = now
		client.commandCount = 0
	}
	if client.commandCount >= 30 {
		return false
	}
	client.commandCount++
	return true
}

func (b *kernelBattle) flushCommandReceipts(instance *jsKernelInstance) {
	b.mu.RLock()
	pending := len(b.pendingReceipts)
	b.mu.RUnlock()
	if pending == 0 {
		return
	}
	result, err := instance.call("drainCommandReceipts")
	if err != nil {
		return
	}
	tokens, _ := result["tokens"].([]any)
	for _, raw := range tokens {
		token, _ := raw.(string)
		b.mu.Lock()
		receipt, ok := b.pendingReceipts[token]
		delete(b.pendingReceipts, token)
		b.mu.Unlock()
		if !ok {
			continue
		}
		delay := float64(time.Since(receipt.queuedAt).Microseconds()) / 1000
		b.performance.mu.Lock()
		b.performance.commandsProcessed++
		b.performance.lastCommandMS = delay
		b.performance.mu.Unlock()
		// Processing is distinct from the subsequent authoritative-state match.
		b.sendApplication(receipt.client, map[string]any{"type": "command_processed", "revision": receipt.revision, "queueMs": delay})
	}
}
