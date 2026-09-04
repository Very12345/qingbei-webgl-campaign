package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdaptiveArtworkAndConditionalCache(t *testing.T) {
	_, mux := newTestHub(t)
	for name, image := range responsiveImages {
		res := requestJSON(t, mux, "GET", "/assets/"+name, nil, "")
		if res.Code != 200 || res.Header().Get("Content-Type") != "image/webp" || !bytes.Equal(res.Body.Bytes(), image.data) {
			t.Fatal(name, res.Code)
		}
		if !strings.Contains(res.Header().Get("Cache-Control"), "immutable") || res.Header().Get("ETag") == "" {
			t.Fatal("uncached artwork")
		}
		req := httptest.NewRequest(http.MethodGet, "/assets/"+name, nil)
		req.Header.Set("If-None-Match", res.Header().Get("ETag"))
		cached := httptest.NewRecorder()
		mux.ServeHTTP(cached, req)
		if cached.Code != 304 || cached.Body.Len() != 0 {
			t.Fatal("cached image retransmitted")
		}
	}
	small := len(responsiveImages["campus-command-v1-480.webp"].data) + len(responsiveImages["field-table-v1-256.webp"].data)
	if small > 30000 {
		t.Fatal("slow-network image budget exceeded", small)
	}
	for _, path := range []string{"/", "/play/"} {
		res := requestJSON(t, mux, "GET", path, nil, "")
		html := res.Body.String()
		if strings.Contains(html, "ADAPTIVE_IMAGE_BOOTSTRAP") || !strings.Contains(html, "QingbeiAdaptiveImages") || strings.Contains(html, "field-table.png") || strings.Contains(html, "campus-command.png") {
			t.Fatal("page bypassed adaptive loading", path)
		}
	}
	if requestJSON(t, mux, "GET", "/assets/campus-command-v1-9999.webp", nil, "").Code != 404 {
		t.Fatal("unbounded artwork variant")
	}
}
