package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"net/http"
	"time"
)

type responsiveImage struct {
	data []byte
	etag string
}

var responsiveImages = func() map[string]responsiveImage {
	images := map[string]responsiveImage{}
	for stem, widths := range map[string][]int{"campus-command": {480, 960, 1536}, "field-table": {256, 512, 960}} {
		for _, width := range widths {
			name := fmt.Sprintf("%s-v1-%d.webp", stem, width)
			data, err := staticFiles.ReadFile("static/" + name)
			if err != nil {
				panic(err)
			}
			images[name] = responsiveImage{data, fmt.Sprintf(`"%x"`, sha256.Sum256(data))}
		}
	}
	return images
}()

func serveResponsiveImage(w http.ResponseWriter, r *http.Request, name string) bool {
	image, ok := responsiveImages[name]
	if !ok {
		return false
	}
	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", image.etag)
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(image.data))
	return true
}

// Inline the tiny selector before CSS is applied: no extra blocking request,
// no original PNG prefetch, and no change to the page's existing CSP.
func hubPage(name string) []byte {
	page, _ := staticFiles.ReadFile("static/" + name)
	script, _ := staticFiles.ReadFile("static/adaptive-images.js")
	return bytes.Replace(page, []byte("/* ADAPTIVE_IMAGE_BOOTSTRAP */"), script, 1)
}
