package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var titles = []string{
	"Statische Seite",
	"Webserver",
	"REST-Backend",
	"Datenbank",
	"Frontend + Backend",
	"Repo + CI",
	"Images in der Pipeline",
	"Deployment",
	"Live-Prüfung",
	"Metriken veröffentlicht",
}

type Check struct {
	Name string `json:"name"`
	Ok   bool   `json:"ok"`
}

type Level struct {
	Level      int            `json:"level"`
	Title      string         `json:"title"`
	Status     string         `json:"status"`
	CheckedAt  *string        `json:"checkedAt"`
	DurationMs *int64         `json:"durationMs"`
	Checks     []Check        `json:"checks"`
	Metrics    map[string]any `json:"metrics"`
}

type Run struct {
	ID        string  `json:"id"`
	Version   string  `json:"version"`
	Commit    *string `json:"commit"`
	UpdatedAt *string `json:"updatedAt"`
}

type Results struct {
	Run    Run    `json:"run"`
	Levels []Level `json:"levels"`
}

type HistoryEntry struct {
	ID         int64          `json:"id"`
	Status     string         `json:"status"`
	CheckedAt  string         `json:"checkedAt"`
	DurationMs int64          `json:"durationMs"`
	Checks     []Check        `json:"checks"`
	Metrics    map[string]any `json:"metrics"`
}

type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

type Store struct {
	db     *sql.DB
	runID  string
	commit *string
	mu     sync.Mutex
}

const schema = `
CREATE TABLE levels (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  status       TEXT    NOT NULL CHECK (status IN ('offen','bestanden','fehlgeschlagen','gesperrt')),
  checked_at   TEXT,
  duration_ms  INTEGER,
  checks       TEXT    NOT NULL DEFAULT '[]',
  metrics      TEXT    NOT NULL DEFAULT '{}'
);
CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL REFERENCES levels(level),
  status       TEXT    NOT NULL CHECK (status IN ('bestanden','fehlgeschlagen')),
  checked_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  checks       TEXT    NOT NULL,
  metrics      TEXT    NOT NULL
);
CREATE INDEX reports_level ON reports(level, id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`

func OpenStore(path, runID string, commit *string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db, runID: runID, commit: commit}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	var version int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version == 1 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, statement := range splitStatements(schema) {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	for i, title := range titles {
		if _, err := tx.Exec(
			"INSERT INTO levels(level, status, checked_at, duration_ms, checks, metrics) VALUES(?, 'offen', NULL, NULL, '[]', '{}')",
			i+1,
		); err != nil {
			return err
		}
		_ = title
	}
	if _, err := tx.Exec("PRAGMA user_version = 1"); err != nil {
		return err
	}
	return tx.Commit()
}

func splitStatements(sqlText string) []string {
	var result []string
	current := ""
	for _, line := range splitLines(sqlText) {
		current += line + "\n"
		if len(line) > 0 && line[len(line)-1] == ';' {
			result = append(result, current)
			current = ""
		}
	}
	return result
}

func splitLines(text string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			lines = append(lines, trimCR(text[start:i]))
			start = i + 1
		}
	}
	if start < len(text) {
		lines = append(lines, trimCR(text[start:]))
	}
	return lines
}

func trimCR(value string) string {
	if len(value) > 0 && value[len(value)-1] == '\r' {
		return value[:len(value)-1]
	}
	return value
}

func decodeChecks(raw string) []Check {
	checks := []Check{}
	if err := json.Unmarshal([]byte(raw), &checks); err != nil {
		return []Check{}
	}
	if checks == nil {
		return []Check{}
	}
	return checks
}

func decodeMetrics(raw string) map[string]any {
	metrics := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &metrics); err != nil {
		return map[string]any{}
	}
	if metrics == nil {
		return map[string]any{}
	}
	return metrics
}

func readResults(q queryer, runID string, commit *string) (Results, error) {
	rows, err := q.Query("SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels ORDER BY level")
	if err != nil {
		return Results{}, err
	}
	defer rows.Close()
	levels := []Level{}
	for rows.Next() {
		var level Level
		var checkedAt sql.Null[string]
		var durationMs sql.Null[int64]
		var checksRaw, metricsRaw string
		if err := rows.Scan(&level.Level, &level.Status, &checkedAt, &durationMs, &checksRaw, &metricsRaw); err != nil {
			return Results{}, err
		}
		if checkedAt.Valid {
			value := checkedAt.V
			level.CheckedAt = &value
		}
		if durationMs.Valid {
			value := durationMs.V
			level.DurationMs = &value
		}
		level.Checks = decodeChecks(checksRaw)
		level.Metrics = decodeMetrics(metricsRaw)
		if level.Level >= 1 && level.Level <= len(titles) {
			level.Title = titles[level.Level-1]
		}
		levels = append(levels, level)
	}
	if err := rows.Err(); err != nil {
		return Results{}, err
	}
	var updatedAt sql.Null[string]
	if err := q.QueryRow("SELECT value FROM meta WHERE key = 'updated_at'").Scan(&updatedAt); err != nil && err != sql.ErrNoRows {
		return Results{}, err
	}
	run := Run{ID: runID, Version: "0.1.0", Commit: commit}
	if updatedAt.Valid {
		value := updatedAt.V
		run.UpdatedAt = &value
	}
	return Results{Run: run, Levels: levels}, nil
}

func (s *Store) Snapshot() (Results, error) {
	return readResults(s.db, s.runID, s.commit)
}

func (s *Store) LevelByNumber(n int) (Level, error) {
	return readLevel(s.db, n)
}

func readLevel(q queryer, n int) (Level, error) {
	var level Level
	var checkedAt sql.Null[string]
	var durationMs sql.Null[int64]
	var checksRaw, metricsRaw string
	err := q.QueryRow("SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels WHERE level = ?", n).
		Scan(&level.Level, &level.Status, &checkedAt, &durationMs, &checksRaw, &metricsRaw)
	if err != nil {
		return Level{}, err
	}
	if checkedAt.Valid {
		value := checkedAt.V
		level.CheckedAt = &value
	}
	if durationMs.Valid {
		value := durationMs.V
		level.DurationMs = &value
	}
	level.Checks = decodeChecks(checksRaw)
	level.Metrics = decodeMetrics(metricsRaw)
	if n >= 1 && n <= len(titles) {
		level.Title = titles[n-1]
	}
	return level, nil
}

func (s *Store) Report(n int, checks []Check, durationMs int64, metrics map[string]any) (Results, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return Results{}, 500
	}
	defer func() { _ = tx.Rollback() }()

	for i := 1; i < n; i++ {
		var status string
		if err := tx.QueryRow("SELECT status FROM levels WHERE level = ?", i).Scan(&status); err != nil {
			return Results{}, 500
		}
		if status != "bestanden" {
			return Results{}, 409
		}
	}

	if metrics == nil {
		metrics = map[string]any{}
	}
	allOk := true
	for _, check := range checks {
		if !check.Ok {
			allOk = false
		}
	}
	status := "fehlgeschlagen"
	if allOk {
		status = "bestanden"
	}
	checkedAt := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	checksJSON, err := json.Marshal(checks)
	if err != nil {
		return Results{}, 500
	}
	metricsJSON, err := json.Marshal(metrics)
	if err != nil {
		return Results{}, 500
	}

	if _, err := tx.Exec(
		"INSERT INTO reports(level, status, checked_at, duration_ms, checks, metrics) VALUES(?, ?, ?, ?, ?, ?)",
		n, status, checkedAt, durationMs, string(checksJSON), string(metricsJSON),
	); err != nil {
		return Results{}, 500
	}
	if _, err := tx.Exec(
		"UPDATE levels SET status = ?, checked_at = ?, duration_ms = ?, checks = ?, metrics = ? WHERE level = ?",
		status, checkedAt, durationMs, string(checksJSON), string(metricsJSON), n,
	); err != nil {
		return Results{}, 500
	}
	higherStatus := "offen"
	if status != "bestanden" {
		higherStatus = "gesperrt"
	}
	if _, err := tx.Exec(
		"UPDATE levels SET status = ?, checked_at = NULL, duration_ms = NULL, checks = '[]', metrics = '{}' WHERE level > ?",
		higherStatus, n,
	); err != nil {
		return Results{}, 500
	}
	if _, err := tx.Exec(
		"INSERT INTO meta(key, value) VALUES('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		checkedAt,
	); err != nil {
		return Results{}, 500
	}

	result, err := readResults(tx, s.runID, s.commit)
	if err != nil {
		return Results{}, 500
	}
	if err := tx.Commit(); err != nil {
		return Results{}, 500
	}
	return result, 200
}

func (s *Store) History(n int, limit int) ([]HistoryEntry, error) {
	rows, err := s.db.Query(
		"SELECT id, status, checked_at, duration_ms, checks, metrics FROM reports WHERE level = ? ORDER BY id DESC LIMIT ?",
		n, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []HistoryEntry{}
	for rows.Next() {
		var entry HistoryEntry
		var checksRaw, metricsRaw string
		if err := rows.Scan(&entry.ID, &entry.Status, &entry.CheckedAt, &entry.DurationMs, &checksRaw, &metricsRaw); err != nil {
			return nil, err
		}
		entry.Checks = decodeChecks(checksRaw)
		entry.Metrics = decodeMetrics(metricsRaw)
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *Store) health(version string) map[string]any {
	return map[string]any{"status": "ok", "version": version, "commit": s.commit}
}

