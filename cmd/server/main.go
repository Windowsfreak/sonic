package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/windowsfreak/sonic/internal/api"
	"github.com/windowsfreak/sonic/internal/cache"
	"github.com/windowsfreak/sonic/internal/tlsfetch"
)

func main() {
	port := flag.Int("port", 8080, "HTTP server port (used when no socket is specified)")
	socketPath := flag.String("socket", "", "UNIX socket path to listen on (optional, or via UNIX env)")
	dataPath := flag.String("data", "./data", "Path to data directory")
	scriptsPath := flag.String("scripts", "./scripts", "Path to crawler scripts directory")
	frontendPath := flag.String("frontend", "./frontend", "Path to frontend static directory")
	expiryMinutes := flag.Int("expiry", 240, "Cache expiration in minutes (default: 240)")
	tlsFetchMode := flag.Bool("tls-fetch", false, "Run one-shot TLS-impersonated HTTP batch client reading JSON from stdin")
	flag.Parse()

	if *tlsFetchMode {
		var batchReq tlsfetch.BatchRequest
		if err := json.NewDecoder(os.Stdin).Decode(&batchReq); err != nil {
			log.Fatalf("[tls-fetch] invalid JSON input: %v", err)
		}
		batchResp, err := tlsfetch.ExecuteBatch(context.Background(), batchReq)
		if err != nil {
			log.Fatalf("[tls-fetch] execution failed: %v", err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(batchResp); err != nil {
			log.Fatalf("[tls-fetch] encode output: %v", err)
		}
		return
	}

	sock := *socketPath
	if sock == "" {
		sock = os.Getenv("UNIX")
	}
	if sock == "" {
		sock = os.Getenv("SOCKET")
	}

	if envPort := os.Getenv("PORT"); envPort != "" && sock == "" {
		fmt.Sscanf(envPort, "%d", port)
	}

	log.Printf("[Server] Initializing Sonic Service...")

	cacheMgr, err := cache.NewManager(*dataPath, *scriptsPath, time.Duration(*expiryMinutes)*time.Minute)
	if err != nil {
		log.Fatalf("[Server] Failed to initialize cache manager: %v", err)
	}

	server := api.NewServer(cacheMgr, *frontendPath)

	httpServer := &http.Server{
		Handler:      server.Router(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	var listener net.Listener

	if sock != "" {
		if dir := filepath.Dir(sock); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0755); err != nil {
				log.Printf("[Server] Warning: failed to create socket dir %s: %v", dir, err)
			}
		}

		_ = os.Remove(sock)

		l, err := net.Listen("unix", sock)
		if err != nil {
			log.Fatalf("[Server] Failed to listen on unix:%s: %v", sock, err)
		}
		defer os.Remove(sock)

		if err := os.Chmod(sock, 0666); err != nil {
			log.Printf("[Server] Could not change permissions to 0666 on unix:%s: %v", sock, err)
		}

		listener = l
		log.Printf("[Server] Listening on unix:%s", sock)
	} else {
		addr := fmt.Sprintf(":%d", *port)
		l, err := net.Listen("tcp", addr)
		if err != nil {
			log.Fatalf("[Server] Failed to listen on %s: %v", addr, err)
		}
		listener = l
		log.Printf("[Server] Listening on http://localhost:%d", *port)
	}

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Server] HTTP server error: %v", err)
		}
	}()

	<-stop
	log.Println("[Server] Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[Server] Server shutdown error: %v", err)
	}

	if sock != "" {
		_ = os.Remove(sock)
	}

	log.Println("[Server] Server stopped.")
}
