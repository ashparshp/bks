package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"leaddesk/api/internal/lead"
	"log"
	"net/http"
	"net/url"
	"strings"
)

func (s *Server) importHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CSV string `json:"csv"`
		URL string `json:"url"`
	}
	if decodeJSON(r, &input) != nil {
		writeJSON(w, map[string]string{"error": "invalid JSON"}, 400)
		return
	}
	raw := input.CSV
	source := "csv"
	if input.URL != "" {
		source = "google_sheet"
		sheetURL, err := googleSheetsCSVURL(input.URL)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()}, 400)
			return
		}
		response, err := http.Get(sheetURL)
		if err != nil {
			writeJSON(w, map[string]string{"error": "could not download Google Sheet CSV"}, 400)
			return
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			log.Printf("import source=%s download_status=%d", source, response.StatusCode)
			writeJSON(w, map[string]string{"error": fmt.Sprintf("Google Sheets returned HTTP %d; publish the sheet to the web as CSV and try again", response.StatusCode)}, 400)
			return
		}
		data, _ := io.ReadAll(io.LimitReader(response.Body, 10<<20))
		raw = string(data)
	}
	log.Printf("import started source=%s bytes=%d", source, len(raw))
	records, err := csv.NewReader(strings.NewReader(raw)).ReadAll()
	if err != nil || len(records) < 2 {
		writeJSON(w, map[string]string{"error": "provide a CSV with a header row and at least one data row; Google Sheets must be published as CSV"}, 400)
		return
	}
	headers := map[string]int{}
	for i, name := range records[0] {
		headers[strings.ToLower(strings.TrimSpace(name))] = i
	}
	if _, hasEmail := headers["email"]; !hasEmail {
		if _, hasPhone := headers["phone"]; !hasPhone {
			writeJSON(w, map[string]string{"error": "CSV must include an email or phone column"}, 400)
			return
		}
	}
	value := func(row []string, name string) string {
		if index, ok := headers[name]; ok && index < len(row) {
			return strings.TrimSpace(row[index])
		}
		return ""
	}
	imported := 0
	skipped := 0
	empty := 0
	duplicates := 0
	invalid := 0
	for _, row := range records[1:] {
		input := lead.Input{Name: value(row, "name"), Email: value(row, "email"), Phone: value(row, "phone"), Category: value(row, "category"), Subcategory: value(row, "subcategory")}
		if input.Email == "" && input.Phone == "" {
			skipped++
			empty++
			continue
		}
		if _, err := s.leads.Create(input); err == nil {
			imported++
		} else {
			skipped++
			if errors.Is(err, lead.ErrInvalidEmail) {
				invalid++
			} else {
				duplicates++
			}
			log.Printf("import row skipped email=%t phone=%t error=%v", input.Email != "", input.Phone != "", err)
		}
	}
	log.Printf("import complete source=%s rows=%d imported=%d skipped=%d duplicates=%d empty=%d invalid=%d", source, len(records)-1, imported, skipped, duplicates, empty, invalid)
	writeJSON(w, map[string]int{"imported": imported, "rows": len(records) - 1, "skipped": skipped, "duplicates": duplicates, "empty": empty, "invalid": invalid}, 200)
}

func googleSheetsCSVURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", fmt.Errorf("Google Sheet URL must be a valid HTTPS URL")
	}
	if parsed.Host != "docs.google.com" || !strings.HasPrefix(parsed.Path, "/spreadsheets/d/") || strings.Contains(parsed.Path, "/d/e/") {
		return parsed.String(), nil
	}
	parts := strings.Split(strings.TrimPrefix(parsed.Path, "/spreadsheets/d/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", fmt.Errorf("could not find a spreadsheet ID in the Google Sheet URL")
	}
	query := url.Values{}
	if gid := parsed.Query().Get("gid"); gid != "" {
		query.Set("gid", gid)
	}
	query.Set("format", "csv")
	return "https://docs.google.com/spreadsheets/d/" + parts[0] + "/export?" + query.Encode(), nil
}
