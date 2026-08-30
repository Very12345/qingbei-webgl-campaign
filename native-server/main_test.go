package main

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDownloadVerifiedUpdateFallsBackAndVerifies(t *testing.T) {
	payload := []byte("qingbei-update-payload")
	digest := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/primary/server.exe.sha256":
			http.Error(writer, "primary unavailable", http.StatusServiceUnavailable)
		case "/fallback/server.exe.sha256":
			_, _ = fmt.Fprintf(writer, "%x  server.exe\n", digest)
		case "/fallback/server.exe":
			_, _ = writer.Write(payload)
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := &http.Client{Timeout: 2 * time.Second}
	data, source, err := downloadVerifiedUpdate(
		client,
		"server.exe",
		[]updateSource{
			{name: "primary", baseURL: server.URL + "/primary/", attempts: 1},
			{name: "fallback", baseURL: server.URL + "/fallback/", attempts: 1},
		},
	)
	if err != nil {
		t.Fatalf("fallback download failed: %v", err)
	}
	if source != "fallback" {
		t.Fatalf("expected fallback source, got %q", source)
	}
	if string(data) != string(payload) {
		t.Fatalf("unexpected payload %q", data)
	}
}

func TestDownloadVerifiedUpdateRejectsBadChecksum(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/server.exe.sha256" {
			_, _ = writer.Write([]byte("0000  server.exe\n"))
			return
		}
		_, _ = writer.Write([]byte("corrupted"))
	}))
	defer server.Close()

	_, _, err := downloadVerifiedUpdate(
		&http.Client{Timeout: 2 * time.Second},
		"server.exe",
		[]updateSource{{name: "bad", baseURL: server.URL + "/", attempts: 1}},
	)
	if err == nil {
		t.Fatal("expected checksum failure")
	}
}
