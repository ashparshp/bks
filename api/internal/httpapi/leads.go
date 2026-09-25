package httpapi

import (
	"errors"
	"leaddesk/api/internal/lead"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) leadsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		s.createLead(w, r)
		return
	}
	leads, err := s.leads.List(lead.ListFilter{Query: r.URL.Query().Get("q"), Category: r.URL.Query().Get("category")})
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, leads, http.StatusOK)
}
func (s *Server) createLead(w http.ResponseWriter, r *http.Request) {
	var input lead.Input
	if decodeJSON(r, &input) != nil {
		writeJSON(w, map[string]string{"error": "invalid JSON"}, 400)
		return
	}
	if strings.TrimSpace(input.Email) == "" && strings.TrimSpace(input.Phone) == "" {
		writeJSON(w, map[string]string{"error": "email or phone is required"}, 400)
		return
	}
	id, err := s.leads.Create(input)
	if err != nil {
		if errors.Is(err, lead.ErrInvalidEmail) {
			writeJSON(w, map[string]string{"error": "invalid email address"}, 400)
			return
		}
		writeJSON(w, map[string]string{"error": "A lead with this email or phone already exists"}, 409)
		return
	}
	writeJSON(w, map[string]any{"id": id}, 201)
}
func (s *Server) leadDetailHandler(w http.ResponseWriter, r *http.Request) {
	id, action, err := leadID(r.URL.Path)
	if err != nil {
		writeJSON(w, map[string]string{"error": "bad lead id"}, 400)
		return
	}
	switch {
	case action == "events" && r.Method == http.MethodGet:
		s.events(w, id)
	case action == "reply" && r.Method == http.MethodPost:
		s.recordReply(w, r, id)
	case action == "invalid" && r.Method == http.MethodPatch:
		s.markInvalid(w, id)
	default:
		writeJSON(w, map[string]string{"error": "not found"}, 404)
	}
}
func (s *Server) events(w http.ResponseWriter, id int64) {
	events, err := s.leads.Events(id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, events, 200)
}
func (s *Server) recordReply(w http.ResponseWriter, r *http.Request, id int64) {
	var input struct {
		Content string `json:"content"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, map[string]string{"error": "invalid JSON"}, 400)
		return
	}
	if err := s.leads.RecordReply(id, input.Content); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true}, 200)
}
func (s *Server) markInvalid(w http.ResponseWriter, id int64) {
	if err := s.leads.MarkInvalid(id); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true}, 200)
}
func leadID(path string) (int64, string, error) {
	parts := strings.Split(strings.TrimPrefix(path, "/api/leads/"), "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	return id, action, err
}
func serverError(w http.ResponseWriter, err error) {
	writeJSON(w, map[string]string{"error": err.Error()}, http.StatusInternalServerError)
}
