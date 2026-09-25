package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"leaddesk/api/internal/lead"
	"leaddesk/api/internal/mailer"
)

type Server struct {
	leads         *lead.Repository
	mailer        mailer.Mailer
	inbound       mailer.ReceivedEmailReader
	corsOrigin    string
	webhookSecret string
}

func New(leads *lead.Repository, mailer mailer.Mailer, inbound mailer.ReceivedEmailReader, webhookSecret, corsOrigin string) *Server {
	return &Server{leads: leads, mailer: mailer, inbound: inbound, webhookSecret: webhookSecret, corsOrigin: corsOrigin}
}
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/api/leads", s.leadsHandler)
	mux.HandleFunc("/api/leads/", s.leadDetailHandler)
	mux.HandleFunc("/api/import", s.importHandler)
	mux.HandleFunc("/api/automation/send", s.automationHandler)
	mux.HandleFunc("/api/dashboard", s.dashboardHandler)
	mux.HandleFunc("/webhooks/resend", s.resendWebhookHandler)
	mux.HandleFunc("/track/open/", s.trackingHandler)
	return logging(cors(mux, s.corsOrigin))
}
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		writer := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(writer, r)
		log.Printf("http method=%s path=%s status=%d duration=%s", r.Method, r.URL.Path, writer.status, time.Since(started).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func cors(next http.Handler, origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func writeJSON(w http.ResponseWriter, value any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func decodeJSON(r *http.Request, value any) error { return json.NewDecoder(r.Body).Decode(value) }
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"status": "ok"}, http.StatusOK)
}
