package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strconv"
)

const version = "0.1.0"

var levelPattern = regexp.MustCompile(`^[0-9]+$`)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
}

func writeError(w http.ResponseWriter, status int, text string) {
	writeJSON(w, status, map[string]string{"error": text})
}

func parseLevelNumber(r *http.Request) (int, bool) {
	raw := r.PathValue("n")
	if !levelPattern.MatchString(raw) {
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 10 {
		return 0, false
	}
	return n, true
}

func methodNotAllowed(w http.ResponseWriter, allowed string) {
	w.Header().Set("Allow", allowed)
	writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
}

func newHandler(store *Store) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.health(version))
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		methodNotAllowed(w, "GET")
	})

	mux.HandleFunc("GET /api/levels", func(w http.ResponseWriter, r *http.Request) {
		result, err := store.Snapshot()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("/api/levels", func(w http.ResponseWriter, r *http.Request) {
		methodNotAllowed(w, "GET")
	})

	mux.HandleFunc("GET /api/levels/{n}", func(w http.ResponseWriter, r *http.Request) {
		n, ok := parseLevelNumber(r)
		if !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		level, err := store.LevelByNumber(n)
		if err != nil {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		writeJSON(w, http.StatusOK, level)
	})
	mux.HandleFunc("/api/levels/{n}", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := parseLevelNumber(r); !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		methodNotAllowed(w, "GET")
	})

	mux.HandleFunc("POST /api/levels/{n}/result", func(w http.ResponseWriter, r *http.Request) {
		handleResult(w, r, store)
	})
	mux.HandleFunc("/api/levels/{n}/result", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := parseLevelNumber(r); !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		methodNotAllowed(w, "POST")
	})

	mux.HandleFunc("GET /api/levels/{n}/history", func(w http.ResponseWriter, r *http.Request) {
		n, ok := parseLevelNumber(r)
		if !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		limit := 50
		if raw := r.URL.Query().Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 500 {
				writeError(w, http.StatusBadRequest, "ungültiges limit")
				return
			}
			limit = parsed
		}
		entries, err := store.History(n, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"level": n, "entries": entries})
	})
	mux.HandleFunc("/api/levels/{n}/history", func(w http.ResponseWriter, r *http.Request) {
		if _, ok := parseLevelNumber(r); !ok {
			writeError(w, http.StatusNotFound, "unbekanntes Level")
			return
		}
		methodNotAllowed(w, "GET")
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "nicht gefunden")
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		println(r.Method, r.URL.Path)
		mux.ServeHTTP(w, r)
	})
}

type rawCheck struct {
	Name *string `json:"name"`
	Ok   *bool   `json:"ok"`
}

type rawReport struct {
	Checks     *[]rawCheck     `json:"checks"`
	DurationMs *json.Number    `json:"durationMs"`
	Metrics    *map[string]any `json:"metrics"`
}

func handleResult(w http.ResponseWriter, r *http.Request, store *Store) {
	n, ok := parseLevelNumber(r)
	if !ok {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if len(body) > 65536 {
		writeError(w, http.StatusRequestEntityTooLarge, "Anfrage zu groß")
		return
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	var raw rawReport
	if err := decoder.Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if raw.Checks == nil || len(*raw.Checks) < 1 || len(*raw.Checks) > 100 {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	checks := make([]Check, 0, len(*raw.Checks))
	for _, item := range *raw.Checks {
		if item.Name == nil || *item.Name == "" || item.Ok == nil {
			writeError(w, http.StatusBadRequest, "ungültige Anfrage")
			return
		}
		checks = append(checks, Check{Name: *item.Name, Ok: *item.Ok})
	}
	if raw.DurationMs == nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	duration, err := raw.DurationMs.Int64()
	if err != nil || duration < 0 {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	metrics := map[string]any{}
	if raw.Metrics != nil && *raw.Metrics != nil {
		metrics = *raw.Metrics
	}

	result, status := store.Report(n, checks, duration, metrics)
	switch status {
	case 200:
		writeJSON(w, http.StatusOK, result)
	case 409:
		writeError(w, http.StatusConflict, "ein niedrigeres Level ist nicht bestanden")
	default:
		writeError(w, http.StatusInternalServerError, "interner Fehler")
	}
}
