package lead

import (
	"database/sql"
	"errors"
	"net/mail"
	"strings"
)

const selectLeads = `SELECT id,name,email,phone,category,subcategory,mail_sent,is_invalid,is_opened,any_followup,followup_count,replied,created_at FROM leads`

var ErrInvalidEmail = errors.New("invalid email address")

type Repository struct{ db *sql.DB }

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

func (r *Repository) Create(input Input) (int64, error) {
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	input.Phone = strings.TrimSpace(input.Phone)
	if input.Email != "" {
		parsed, err := mail.ParseAddress(input.Email)
		if err != nil || parsed.Address != input.Email || len(input.Email) > 254 {
			return 0, ErrInvalidEmail
		}
	}
	result, err := r.db.Exec(`INSERT INTO leads(name,email,phone,category,subcategory,is_invalid) VALUES(?,?,?,?,?,0)`, input.Name, input.Email, input.Phone, input.Category, input.Subcategory)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (r *Repository) List(filter ListFilter) ([]Lead, error) {
	query, category := "%"+filter.Query+"%", "%"+filter.Category+"%"
	rows, err := r.db.Query(selectLeads+` WHERE (email LIKE ? OR phone LIKE ? OR name LIKE ?) AND category LIKE ? ORDER BY id DESC`, query, query, query, category)
	if err != nil {
		return nil, err
	}
	return scanLeads(rows)
}

func (r *Repository) CampaignTargets(c Campaign) ([]Lead, error) {
	where := ` WHERE is_invalid=0 AND replied=0 AND email != ''`
	args := []any{}
	if c.Mode == "followup" {
		where += ` AND mail_sent=1`
	} else {
		where += ` AND mail_sent=0`
	}
	if c.NoFollowup {
		where += ` AND any_followup=0`
	}
	if c.Mode == "followup" && c.MaxFollowups > 0 {
		where += ` AND followup_count < ?`
		args = append(args, c.MaxFollowups)
	}
	if c.Category != "" {
		where += ` AND category=?`
		args = append(args, c.Category)
	}
	if c.Before != "" {
		where += ` AND date(created_at)<=date(?)`
		args = append(args, c.Before)
	}
	rows, err := r.db.Query(selectLeads+where, args...)
	if err != nil {
		return nil, err
	}
	return scanLeads(rows)
}

func (r *Repository) RecordSend(id int64, campaign Campaign) error {
	if campaign.Mode == "followup" {
		if _, err := r.db.Exec(`UPDATE leads SET any_followup=1, followup_count=followup_count+1 WHERE id=?`, id); err != nil {
			return err
		}
	} else if _, err := r.db.Exec(`UPDATE leads SET mail_sent=1 WHERE id=?`, id); err != nil {
		return err
	}
	_, err := r.db.Exec(`INSERT INTO email_events(lead_id,kind,subject,body) VALUES(?,?,?,?)`, id, campaign.Mode, campaign.Subject, campaign.Body)
	return err
}
func (r *Repository) Events(id int64) ([]Event, error) {
	rows, err := r.db.Query(`SELECT id,kind,subject,body,content,created_at FROM email_events WHERE lead_id=? ORDER BY id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Kind, &e.Subject, &e.Body, &e.Content, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
func (r *Repository) RecordReply(id int64, content string) error {
	if _, err := r.db.Exec(`UPDATE leads SET replied=1 WHERE id=?`, id); err != nil {
		return err
	}
	_, err := r.db.Exec(`INSERT INTO email_events(lead_id,kind,content) VALUES(?, 'reply', ?)`, id, content)
	return err
}
func (r *Repository) MarkInvalid(id int64) error {
	_, err := r.db.Exec(`UPDATE leads SET is_invalid=1 WHERE id=?`, id)
	return err
}
func (r *Repository) MarkOpened(id int64) error {
	if _, err := r.db.Exec(`UPDATE leads SET is_opened=1 WHERE id=?`, id); err != nil {
		return err
	}
	_, err := r.db.Exec(`INSERT INTO email_events(lead_id,kind) VALUES(?, 'opened')`, id)
	return err
}
func (r *Repository) Stats() (Stats, error) {
	var stats Stats
	err := r.db.QueryRow(`SELECT COUNT(*),COALESCE(SUM(mail_sent),0),COALESCE(SUM(is_opened),0),COALESCE(SUM(replied),0),COALESCE(SUM(is_invalid),0) FROM leads`).Scan(&stats.Total, &stats.Emailed, &stats.Opened, &stats.Replied, &stats.Invalid)
	return stats, err
}

// ProcessWebhook writes an activity record once, even when Resend retries the same Svix message.
func (r *Repository) ProcessWebhook(receiptID string, event WebhookEvent) (bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT OR IGNORE INTO webhook_receipts(id,event_type) VALUES(?,?)`, receiptID, event.Type)
	if err != nil {
		return false, err
	}
	inserted, _ := result.RowsAffected()
	if inserted == 0 {
		return false, tx.Commit()
	}

	address := event.Recipient
	if event.Type == "email.received" {
		address = event.Sender
	}
	var leadID int64
	err = tx.QueryRow(`SELECT id FROM leads WHERE email = ?`, strings.ToLower(address)).Scan(&leadID)
	if err == sql.ErrNoRows {
		return false, tx.Commit()
	}
	if err != nil {
		return false, err
	}

	kind, content := strings.TrimPrefix(event.Type, "email."), event.Content
	if event.Type == "email.received" {
		kind = "reply"
		if _, err = tx.Exec(`UPDATE leads SET replied=1 WHERE id=?`, leadID); err != nil {
			return false, err
		}
	}
	if event.Type == "email.bounced" {
		content = strings.TrimSpace(strings.Join([]string{event.BounceType, event.BounceMessage}, ": "))
		if _, err = tx.Exec(`UPDATE leads SET is_invalid=1 WHERE id=?`, leadID); err != nil {
			return false, err
		}
	}
	if event.Type == "email.opened" {
		if _, err = tx.Exec(`UPDATE leads SET is_opened=1 WHERE id=?`, leadID); err != nil {
			return false, err
		}
	}
	if content == "" {
		content = "Resend reported " + kind + "."
	}
	_, err = tx.Exec(`INSERT INTO email_events(lead_id,kind,subject,content) VALUES(?,?,?,?)`, leadID, kind, event.Subject, content)
	if err != nil {
		return false, err
	}
	return true, tx.Commit()
}
func scanLeads(rows *sql.Rows) ([]Lead, error) {
	defer rows.Close()
	leads := []Lead{}
	for rows.Next() {
		var l Lead
		var mailSent, invalid, opened, followup, replied int
		if err := rows.Scan(&l.ID, &l.Name, &l.Email, &l.Phone, &l.Category, &l.Subcategory, &mailSent, &invalid, &opened, &followup, &l.FollowupCount, &replied, &l.CreatedAt); err != nil {
			return nil, err
		}
		l.MailSent = mailSent == 1
		l.IsInvalid = invalid == 1
		l.IsOpened = opened == 1
		l.AnyFollowup = followup == 1
		l.Replied = replied == 1
		leads = append(leads, l)
	}
	return leads, rows.Err()
}
