package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	_ "modernc.org/sqlite"
)

func testStore(t *testing.T) (*Store, http.Handler) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "levelboard.db"), "lokal", nil)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, newHandler(store)
}

func request(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func decodeResults(t *testing.T, recorder *httptest.ResponseRecorder) Results {
	t.Helper()
	var result Results
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("Antwort ist kein Results: %v (%s)", err, recorder.Body.String())
	}
	return result
}

func TestStartzustand(t *testing.T) {
	_, handler := testStore(t)
	recorder := request(t, handler, http.MethodGet, "/api/levels", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("Status = %d", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	result := decodeResults(t, recorder)
	if len(result.Levels) != 10 {
		t.Fatalf("Levels = %d", len(result.Levels))
	}
	for i, level := range result.Levels {
		if level.Level != i+1 || level.Status != "offen" || level.CheckedAt != nil || level.DurationMs != nil || len(level.Checks) != 0 {
			t.Fatalf("Level %d ist nicht im Startzustand: %+v", i+1, level)
		}
	}
}

func TestRegelnFuerMeldungen(t *testing.T) {
	_, handler := testStore(t)

	recorder := request(t, handler, http.MethodPost, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("Level 1: Status = %d, Body = %s", recorder.Code, recorder.Body.String())
	}
	result := decodeResults(t, recorder)
	if result.Levels[0].Status != "bestanden" || result.Levels[0].DurationMs == nil || *result.Levels[0].DurationMs != 10 {
		t.Fatalf("Level 1 falsch: %+v", result.Levels[0])
	}
	if result.Run.UpdatedAt == nil {
		t.Fatal("run.updatedAt fehlt")
	}
	for _, level := range result.Levels[1:] {
		if level.Status != "offen" {
			t.Fatalf("Level %d sollte offen sein, ist %s", level.Level, level.Status)
		}
	}

	recorder = request(t, handler, http.MethodPost, "/api/levels/3/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("409 erwartet, erhalten %d", recorder.Code)
	}

	recorder = request(t, handler, http.MethodPost, "/api/levels/2/result", `{"checks":[{"name":"a","ok":false}],"durationMs":20}`)
	if recorder.Code != http.StatusOK {
		t.Fatalf("Level 2: Status = %d", recorder.Code)
	}
	result = decodeResults(t, recorder)
	if result.Levels[1].Status != "fehlgeschlagen" {
		t.Fatalf("Level 2 = %s", result.Levels[1].Status)
	}
	for _, level := range result.Levels[2:] {
		if level.Status != "gesperrt" {
			t.Fatalf("Level %d sollte gesperrt sein, ist %s", level.Level, level.Status)
		}
	}

	recorder = request(t, handler, http.MethodPost, "/api/levels/3/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("409 erwartet, erhalten %d", recorder.Code)
	}
}

func TestFehlercodes(t *testing.T) {
	_, handler := testStore(t)
	cases := []struct {
		method      string
		path        string
		contentType string
		body        string
		want        int
	}{
		{http.MethodPost, "/api/levels/1/result", "application/json", "{kaputt", 400},
		{http.MethodPost, "/api/levels/1/result", "application/json", `{"durationMs":1}`, 400},
		{http.MethodPost, "/api/levels/1/result", "application/json", `{"checks":[],"durationMs":1}`, 400},
		{http.MethodPost, "/api/levels/1/result", "application/json", `{"checks":[{"name":"a","ok":true,"extra":1}],"durationMs":1}`, 400},
		{http.MethodPost, "/api/levels/1/result", "application/json", `{"checks":[{"name":"a","ok":true}],"durationMs":1.5}`, 400},
		{http.MethodPost, "/api/levels/1/result", "text/plain", `{"checks":[{"name":"a","ok":true}],"durationMs":1}`, 415},
		{http.MethodPost, "/api/levels/1/result", "application/json", `{"checks":[{"name":"a","ok":true}],"durationMs":1,"x":"` + string(bytes.Repeat([]byte("a"), 70000)) + `"}`, 413},
		{http.MethodGet, "/api/levels/1/result", "", "", 405},
		{http.MethodGet, "/api/levels/0", "", "", 404},
		{http.MethodGet, "/api/levels/11", "", "", 404},
		{http.MethodGet, "/api/levels/abc", "", "", 404},
		{http.MethodDelete, "/api/levels", "", "", 405},
		{http.MethodGet, "/api/levels/abc/history", "", "", 404},
		{http.MethodGet, "/api/levels/1/history?limit=0", "", "", 400},
		{http.MethodGet, "/api/levels/1/history?limit=501", "", "", 400},
		{http.MethodGet, "/api/unbekannt", "", "", 404},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
		if tc.contentType != "" {
			req.Header.Set("Content-Type", tc.contentType)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != tc.want {
			t.Errorf("%s %s: Status = %d, will %d, Body = %s", tc.method, tc.path, recorder.Code, tc.want, recorder.Body.String())
		}
		if recorder.Header().Get("Content-Type") != "application/json" {
			t.Errorf("%s %s: Content-Type = %q", tc.method, tc.path, recorder.Header().Get("Content-Type"))
		}
	}
	recorder := request(t, handler, http.MethodDelete, "/api/levels", "")
	if recorder.Header().Get("Allow") != "GET" {
		t.Errorf("Allow = %q", recorder.Header().Get("Allow"))
	}
}

func TestHistorie(t *testing.T) {
	_, handler := testStore(t)
	for _, duration := range []int{101, 102} {
		body := fmt.Sprintf(`{"checks":[{"name":"a","ok":true}],"durationMs":%d}`, duration)
		if recorder := request(t, handler, http.MethodPost, "/api/levels/1/result", body); recorder.Code != 200 {
			t.Fatalf("Meldung: %d", recorder.Code)
		}
	}
	recorder := request(t, handler, http.MethodGet, "/api/levels/1/history", "")
	if recorder.Code != 200 {
		t.Fatalf("Historie: %d", recorder.Code)
	}
	var history struct {
		Level   int `json:"level"`
		Entries []HistoryEntry
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if history.Level != 1 || len(history.Entries) != 2 {
		t.Fatalf("Historie = %+v", history)
	}
	if history.Entries[0].DurationMs != 102 || history.Entries[1].DurationMs != 101 || history.Entries[0].ID <= history.Entries[1].ID {
		t.Fatalf("Reihenfolge falsch: %+v", history.Entries)
	}

	recorder = request(t, handler, http.MethodGet, "/api/levels/1/history?limit=1", "")
	if err := json.Unmarshal(recorder.Body.Bytes(), &history); err != nil || len(history.Entries) != 1 {
		t.Fatalf("limit=1: %+v %v", history, err)
	}
}

func TestSchemaUndPersistenz(t *testing.T) {
	path := filepath.Join(t.TempDir(), "levelboard.db")
	store, err := OpenStore(path, "lokal", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	handler := newHandler(store)

	if recorder := request(t, handler, http.MethodPost, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":5}`); recorder.Code != 200 {
		t.Fatalf("Meldung: %d", recorder.Code)
	}
	same, err := OpenStore(path, "lokal", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = same.Close() }()
	snapshot, err := same.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Levels[0].Status != "bestanden" || len(snapshot.Levels[0].Checks) != 1 {
		t.Fatalf("Persistenz fehlt: %+v", snapshot.Levels[0])
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 1 {
		t.Fatalf("user_version = %d, %v", version, err)
	}
	checkColumns := func(table string, want []string) {
		rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		got := []string{}
		for rows.Next() {
			var cid int
			var name, typ string
			var notNull, primaryKey int
			var defaultValue any
			if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &primaryKey); err != nil {
				t.Fatal(err)
			}
			got = append(got, name)
		}
		if len(got) != len(want) {
			t.Fatalf("%s: Spalten = %v", table, got)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: Spalte %d = %s, will %s", table, i, got[i], want[i])
			}
		}
	}
	checkColumns("levels", []string{"level", "status", "checked_at", "duration_ms", "checks", "metrics"})
	checkColumns("reports", []string{"id", "level", "status", "checked_at", "duration_ms", "checks", "metrics"})
	checkColumns("meta", []string{"key", "value"})
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM levels").Scan(&count); err != nil || count != 10 {
		t.Fatalf("levels Zeilen = %d, %v", count, err)
	}
}

func TestGleichzeitigeMeldungen(t *testing.T) {
	store, handler := testStore(t)
	const n = 100
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			recorder := request(t, handler, http.MethodPost, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":1}`)
			if recorder.Code != 200 {
				t.Errorf("Status = %d", recorder.Code)
			}
		}()
	}
	wg.Wait()
	entries, err := store.History(1, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != n {
		t.Fatalf("Historie hat %d Einträge, will %d", len(entries), n)
	}
}
