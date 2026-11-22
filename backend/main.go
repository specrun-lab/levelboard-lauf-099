package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := os.Getenv("LEVELBOARD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	dbPath := os.Getenv("LEVELBOARD_DB")
	if dbPath == "" {
		dbPath = ".run/levelboard.db"
	}
	runID := os.Getenv("RUN_ID")
	if runID == "" {
		runID = "lokal"
	}
	var commit *string
	if value := os.Getenv("LEVELBOARD_COMMIT"); value != "" {
		commit = &value
	}

	store, err := OpenStore(dbPath, runID, commit)
	if err != nil {
		println("Backend konnte nicht gestartet werden:", err.Error())
		os.Exit(1)
	}
	defer func() { _ = store.Close() }()

	server := &http.Server{
		Addr:              addr,
		Handler:           newHandler(store),
		ReadHeaderTimeout: 10 * time.Second,
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-signals
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		println("Backendfehler:", err.Error())
		os.Exit(1)
	}
}
