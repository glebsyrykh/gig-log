package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

// ─── Models ───

type Venue struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	FormerNames []string `json:"formerNames"`
	Address     string   `json:"address"`
	Lat         float64  `json:"lat"`
	Lng         float64  `json:"lng"`
	Closed      bool     `json:"closed"`
}

type Event struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	VenueID      string   `json:"venueId"`
	Dates        []string `json:"dates"`
	Artists      []string `json:"artists"`
	SetlistFmURL string   `json:"setlistFmUrl"`
	LastFmURL    string   `json:"lastFmUrl"`
	Notes        string   `json:"notes"`
	FestivalName string   `json:"festivalName"`
	ImageURL     string   `json:"imageUrl"`
	Tags         []string `json:"tags"`
}

// ─── Helpers ───

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func genID() string {
	return fmt.Sprintf("%x%x", time.Now().UnixNano(), time.Now().UnixMicro()%0xFFFF)
}

// ─── Admin auth middleware ───
// Constant-time token comparison to prevent timing attacks.
// Token comes from ADMIN_TOKEN env var — must be set to a strong value.
func adminAuth(next http.Handler) http.Handler {
	token := os.Getenv("ADMIN_TOKEN")
	if token == "" {
		log.Fatal("ADMIN_TOKEN environment variable is required")
	}
	if len(token) < 16 {
		log.Println("WARNING: ADMIN_TOKEN is shorter than 16 characters — use a stronger token")
	}
	tokenBytes := []byte(token)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := []byte(r.Header.Get("X-Admin-Token"))
		if subtle.ConstantTimeCompare(provided, tokenBytes) != 1 {
			// Deliberate delay to slow brute-force attempts
			time.Sleep(500 * time.Millisecond)
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ─── Rate limiter (per-IP, sliding window) ───
type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
	// Cleanup stale entries every minute
	go func() {
		for range time.Tick(time.Minute) {
			rl.mu.Lock()
			cutoff := time.Now().Add(-rl.window)
			for ip, times := range rl.requests {
				filtered := times[:0]
				for _, t := range times {
					if t.After(cutoff) {
						filtered = append(filtered, t)
					}
				}
				if len(filtered) == 0 {
					delete(rl.requests, ip)
				} else {
					rl.requests[ip] = filtered
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	times := rl.requests[ip]
	filtered := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}

	if len(filtered) >= rl.limit {
		rl.requests[ip] = filtered
		return false
	}

	rl.requests[ip] = append(filtered, now)
	return true
}

func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
				ip = strings.Split(fwd, ",")[0]
			}
			ip = strings.TrimSpace(ip)
			if !rl.Allow(ip) {
				w.Header().Set("Retry-After", "60")
				writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ─── Request size limit middleware ───
func maxBodySize(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// ─── Security headers middleware ───
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// ─── Public handlers ───

func getVenues(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(r.Context(),
		`SELECT id, name, former_names, address, lat, lng, closed FROM venues ORDER BY name`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	venues := []Venue{}
	for rows.Next() {
		var v Venue
		if err := rows.Scan(&v.ID, &v.Name, &v.FormerNames, &v.Address, &v.Lat, &v.Lng, &v.Closed); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		if v.FormerNames == nil {
			v.FormerNames = []string{}
		}
		venues = append(venues, v)
	}
	writeJSON(w, 200, venues)
}

func getEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(r.Context(),
		`SELECT id, type, venue_id, dates, artists, setlist_fm_url, last_fm_url, notes, festival_name, image_url, tags
		 FROM events ORDER BY dates[1] DESC`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var e Event
		var dates []time.Time
		if err := rows.Scan(&e.ID, &e.Type, &e.VenueID, &dates, &e.Artists, &e.SetlistFmURL, &e.LastFmURL, &e.Notes, &e.FestivalName, &e.ImageURL, &e.Tags); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		e.Dates = make([]string, len(dates))
		for i, d := range dates {
			e.Dates[i] = d.Format("2006-01-02")
		}
		if e.Artists == nil {
			e.Artists = []string{}
		}
		if e.Tags == nil {
			e.Tags = []string{}
		}
		events = append(events, e)
	}
	writeJSON(w, 200, events)
}

// ─── Admin handlers ───

func createVenue(w http.ResponseWriter, r *http.Request) {
	var v Venue
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if v.Name == "" {
		writeError(w, 400, "name is required")
		return
	}
	if v.ID == "" {
		v.ID = genID()
	}
	if v.FormerNames == nil {
		v.FormerNames = []string{}
	}

	_, err := db.Exec(r.Context(),
		`INSERT INTO venues (id, name, former_names, address, lat, lng, closed)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		v.ID, v.Name, v.FormerNames, v.Address, v.Lat, v.Lng, v.Closed)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, v)
}

func updateVenue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var v Venue
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if v.FormerNames == nil {
		v.FormerNames = []string{}
	}

	tag, err := db.Exec(r.Context(),
		`UPDATE venues SET name=$1, former_names=$2, address=$3, lat=$4, lng=$5, closed=$6, updated_at=NOW()
		 WHERE id=$7`,
		v.Name, v.FormerNames, v.Address, v.Lat, v.Lng, v.Closed, id)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "venue not found")
		return
	}
	v.ID = id
	writeJSON(w, 200, v)
}

func deleteVenue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := db.Exec(r.Context(), `DELETE FROM venues WHERE id=$1`, id)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "venue not found")
		return
	}
	writeJSON(w, 200, map[string]string{"deleted": id})
}

func createEvent(w http.ResponseWriter, r *http.Request) {
	var e Event
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if e.VenueID == "" || len(e.Dates) == 0 || len(e.Artists) == 0 {
		writeError(w, 400, "venueId, dates, and artists are required")
		return
	}
	if e.ID == "" {
		e.ID = genID()
	}
	if e.Type == "" {
		e.Type = "gig"
	}

	dates := make([]time.Time, len(e.Dates))
	for i, ds := range e.Dates {
		t, err := time.Parse("2006-01-02", ds)
		if err != nil {
			writeError(w, 400, fmt.Sprintf("invalid date: %s", ds))
			return
		}
		dates[i] = t
	}

	if e.Tags == nil {
		e.Tags = []string{}
	}

	_, err := db.Exec(r.Context(),
		`INSERT INTO events (id, type, venue_id, dates, artists, setlist_fm_url, last_fm_url, notes, festival_name, image_url, tags)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		e.ID, e.Type, e.VenueID, dates, e.Artists, e.SetlistFmURL, e.LastFmURL, e.Notes, e.FestivalName, e.ImageURL, e.Tags)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, e)
}

func updateEvent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var e Event
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}

	dates := make([]time.Time, len(e.Dates))
	for i, ds := range e.Dates {
		t, err := time.Parse("2006-01-02", ds)
		if err != nil {
			writeError(w, 400, fmt.Sprintf("invalid date: %s", ds))
			return
		}
		dates[i] = t
	}

	tag, err := db.Exec(r.Context(),
		`UPDATE events SET type=$1, venue_id=$2, dates=$3, artists=$4, setlist_fm_url=$5,
		 last_fm_url=$6, notes=$7, festival_name=$8, image_url=$9, tags=$10, updated_at=NOW()
		 WHERE id=$11`,
		e.Type, e.VenueID, dates, e.Artists, e.SetlistFmURL, e.LastFmURL, e.Notes, e.FestivalName, e.ImageURL, e.Tags, id)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "event not found")
		return
	}
	e.ID = id
	writeJSON(w, 200, e)
}

func deleteEvent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := db.Exec(r.Context(), `DELETE FROM events WHERE id=$1`, id)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "event not found")
		return
	}
	writeJSON(w, 200, map[string]string{"deleted": id})
}

func mergeVenues(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TargetID  string   `json:"targetId"`
		SourceIDs []string `json:"sourceIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid JSON")
		return
	}
	if req.TargetID == "" || len(req.SourceIDs) == 0 {
		writeError(w, 400, "targetId and sourceIds required")
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Get target venue
	var target Venue
	err = tx.QueryRow(ctx,
		`SELECT id, name, former_names, address, lat, lng, closed FROM venues WHERE id=$1`, req.TargetID).
		Scan(&target.ID, &target.Name, &target.FormerNames, &target.Address, &target.Lat, &target.Lng, &target.Closed)
	if err != nil {
		writeError(w, 404, "target venue not found")
		return
	}
	if target.FormerNames == nil {
		target.FormerNames = []string{}
	}

	// Collect source venue names as former names
	rows, err := tx.Query(ctx,
		`SELECT name, former_names, lat, lng, address FROM venues WHERE id = ANY($1)`, req.SourceIDs)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	for rows.Next() {
		var sName, sAddr string
		var sFN []string
		var sLat, sLng float64
		rows.Scan(&sName, &sFN, &sLat, &sLng, &sAddr)
		if !contains(target.FormerNames, sName) {
			target.FormerNames = append(target.FormerNames, sName)
		}
		for _, fn := range sFN {
			if !contains(target.FormerNames, fn) {
				target.FormerNames = append(target.FormerNames, fn)
			}
		}
		if target.Lat == 0 && sLat != 0 {
			target.Lat = sLat
			target.Lng = sLng
			if target.Address == "" {
				target.Address = sAddr
			}
		}
	}

	// Reassign events
	_, err = tx.Exec(ctx,
		`UPDATE events SET venue_id=$1 WHERE venue_id = ANY($2)`, req.TargetID, req.SourceIDs)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Delete source venues
	_, err = tx.Exec(ctx, `DELETE FROM venues WHERE id = ANY($1)`, req.SourceIDs)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Update target
	_, err = tx.Exec(ctx,
		`UPDATE venues SET former_names=$1, lat=$2, lng=$3, address=$4, updated_at=NOW() WHERE id=$5`,
		target.FormerNames, target.Lat, target.Lng, target.Address, target.ID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, 500, err.Error())
		return
	}

	writeJSON(w, 200, target)
}

// ─── Export / Import ───

type ExportData struct {
	Venues []Venue `json:"venues"`
	Events []Event `json:"events"`
}

func exportData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	format := r.URL.Query().Get("format") // "json" or "csv", default json

	// Fetch venues
	vRows, err := db.Query(ctx, `SELECT id, name, former_names, address, lat, lng, closed FROM venues ORDER BY name`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer vRows.Close()
	venues := []Venue{}
	for vRows.Next() {
		var v Venue
		if err := vRows.Scan(&v.ID, &v.Name, &v.FormerNames, &v.Address, &v.Lat, &v.Lng, &v.Closed); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		if v.FormerNames == nil {
			v.FormerNames = []string{}
		}
		venues = append(venues, v)
	}

	// Fetch events
	eRows, err := db.Query(ctx, `SELECT id, type, venue_id, dates, artists, setlist_fm_url, last_fm_url, notes, festival_name, image_url, tags FROM events ORDER BY dates[1] DESC`)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer eRows.Close()
	events := []Event{}
	for eRows.Next() {
		var e Event
		var dates []time.Time
		if err := eRows.Scan(&e.ID, &e.Type, &e.VenueID, &dates, &e.Artists, &e.SetlistFmURL, &e.LastFmURL, &e.Notes, &e.FestivalName, &e.ImageURL, &e.Tags); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		e.Dates = make([]string, len(dates))
		for i, d := range dates {
			e.Dates[i] = d.Format("2006-01-02")
		}
		if e.Artists == nil {
			e.Artists = []string{}
		}
		if e.Tags == nil {
			e.Tags = []string{}
		}
		events = append(events, e)
	}

	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=giglog-events.csv")
		w.WriteHeader(200)

		// Build venue lookup
		venueMap := map[string]Venue{}
		for _, v := range venues {
			venueMap[v.ID] = v
		}

		fmt.Fprintf(w, "date,type,artists,venue,address,festival,tags,notes,setlist_fm,last_fm,image_url\n")
		for _, e := range events {
			v := venueMap[e.VenueID]
			dateStr := strings.Join(e.Dates, "; ")
			artistStr := strings.Join(e.Artists, "; ")
			tagStr := strings.Join(e.Tags, "; ")
			fmt.Fprintf(w, "%s,%s,\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",\"%s\",%s,%s,%s\n",
				csvEscape(dateStr), e.Type, csvEscape(artistStr), csvEscape(v.Name), csvEscape(v.Address),
				csvEscape(e.FestivalName), csvEscape(tagStr), csvEscape(e.Notes),
				csvEscape(e.SetlistFmURL), csvEscape(e.LastFmURL), csvEscape(e.ImageURL))
		}
		return
	}

	// JSON export (default)
	w.Header().Set("Content-Disposition", "attachment; filename=giglog-export.json")
	writeJSON(w, 200, ExportData{Venues: venues, Events: events})
}

func csvEscape(s string) string {
	s = strings.ReplaceAll(s, "\"", "\"\"")
	if strings.ContainsAny(s, ",\"\n\r") {
		return "\"" + s + "\""
	}
	return s
}

func importData(w http.ResponseWriter, r *http.Request) {
	var data ExportData
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error())
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	venuesCreated := 0
	for _, v := range data.Venues {
		if v.ID == "" || v.Name == "" {
			continue
		}
		if v.FormerNames == nil {
			v.FormerNames = []string{}
		}
		tag, err := tx.Exec(ctx,
			`INSERT INTO venues (id, name, former_names, address, lat, lng, closed)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET name=$2, former_names=$3, address=$4, lat=$5, lng=$6, closed=$7, updated_at=NOW()`,
			v.ID, v.Name, v.FormerNames, v.Address, v.Lat, v.Lng, v.Closed)
		if err != nil {
			writeError(w, 500, fmt.Sprintf("venue %s: %v", v.ID, err))
			return
		}
		if tag.RowsAffected() > 0 {
			venuesCreated++
		}
	}

	eventsCreated := 0
	for _, e := range data.Events {
		if e.ID == "" || e.VenueID == "" || len(e.Dates) == 0 {
			continue
		}
		if e.Type == "" {
			e.Type = "gig"
		}
		if e.Artists == nil {
			e.Artists = []string{}
		}
		if e.Tags == nil {
			e.Tags = []string{}
		}
		dates := make([]time.Time, len(e.Dates))
		for i, ds := range e.Dates {
			t, err := time.Parse("2006-01-02", ds)
			if err != nil {
				continue
			}
			dates[i] = t
		}

		tag, err := tx.Exec(ctx,
			`INSERT INTO events (id, type, venue_id, dates, artists, setlist_fm_url, last_fm_url, notes, festival_name, image_url, tags)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 ON CONFLICT (id) DO UPDATE SET type=$2, venue_id=$3, dates=$4, artists=$5, setlist_fm_url=$6,
			 last_fm_url=$7, notes=$8, festival_name=$9, image_url=$10, tags=$11, updated_at=NOW()`,
			e.ID, e.Type, e.VenueID, dates, e.Artists, e.SetlistFmURL, e.LastFmURL, e.Notes, e.FestivalName, e.ImageURL, e.Tags)
		if err != nil {
			writeError(w, 500, fmt.Sprintf("event %s: %v", e.ID, err))
			return
		}
		if tag.RowsAffected() > 0 {
			eventsCreated++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, 500, err.Error())
		return
	}

	writeJSON(w, 200, map[string]any{
		"venues": map[string]int{"processed": len(data.Venues), "upserted": venuesCreated},
		"events": map[string]int{"processed": len(data.Events), "upserted": eventsCreated},
	})
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}

// ─── Main ───

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://giglog:giglog@localhost:5432/giglog?sslmode=disable"
	}

	var err error
	ctx := context.Background()

	// Retry connection (wait for postgres in docker)
	for i := 0; i < 30; i++ {
		db, err = pgxpool.New(ctx, dsn)
		if err == nil {
			if err = db.Ping(ctx); err == nil {
				break
			}
		}
		log.Printf("Waiting for database... (%d/30)", i+1)
		time.Sleep(time.Second)
	}
	if err != nil {
		log.Fatalf("Cannot connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Connected to database")

	// Run migrations
	for _, f := range []string{"/app/db/001_schema.sql", "/app/db/002_seed.sql"} {
		if data, err := os.ReadFile(f); err == nil {
			if _, err := db.Exec(ctx, string(data)); err != nil {
				// Seed may partially fail on re-runs, that's ok
				if !strings.Contains(f, "seed") {
					log.Printf("Migration %s error: %v", f, err)
				}
			} else {
				log.Printf("Applied: %s", f)
			}
		}
	}

	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))
	r.Use(securityHeaders)

	// Rate limiting: configurable via RATE_LIMIT env (requests per minute per IP)
	rateLimit := 60
	if rl, err := strconv.Atoi(os.Getenv("RATE_LIMIT")); err == nil && rl > 0 {
		rateLimit = rl
	}
	rl := newRateLimiter(rateLimit, time.Minute)
	r.Use(rateLimitMiddleware(rl))

	// Request body size limit (1MB)
	r.Use(maxBodySize(1 << 20))

	// CORS: lock to specific origins in production
	allowedOrigins := []string{}
	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		allowedOrigins = strings.Split(origins, ",")
		for i := range allowedOrigins {
			allowedOrigins[i] = strings.TrimSpace(allowedOrigins[i])
		}
	}
	// If no origins configured, allow same-origin only (no CORS headers = browser blocks cross-origin)
	if len(allowedOrigins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   allowedOrigins,
			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Content-Type", "X-Admin-Token"},
			AllowCredentials: false,
			MaxAge:           300,
		}))
	}

	// Public API
	r.Get("/api/venues", getVenues)
	r.Get("/api/events", getEvents)

	// Admin API (protected) — stricter rate limit for write operations
	adminRL := newRateLimiter(20, time.Minute)
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(rateLimitMiddleware(adminRL))
		r.Use(adminAuth)
		r.Post("/venues", createVenue)
		r.Put("/venues/{id}", updateVenue)
		r.Delete("/venues/{id}", deleteVenue)
		r.Post("/events", createEvent)
		r.Put("/events/{id}", updateEvent)
		r.Delete("/events/{id}", deleteEvent)
		r.Post("/venues/merge", mergeVenues)
		r.Get("/export", exportData)
		r.Post("/import", importData)
	})

	// Health check
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			writeError(w, 503, "db unavailable")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}
