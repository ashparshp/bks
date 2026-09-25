'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LeadDetails } from '../components/LeadDetails';
import { LeadTable } from '../components/LeadTable';
import { api } from '../lib/api';
import type { DashboardStats, Lead } from '../lib/types';

type Tab = 'leads' | 'import' | 'automation';
type ImportSummary = { rows: number; imported: number; skipped: number; duplicates: number; empty: number; invalid: number };
const emptyStats: DashboardStats = { total: 0, emailed: 0, opened: 0, replied: 0, invalid: 0 };

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [tab, setTab] = useState<Tab>('leads');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  async function refresh(search = query) {
    try {
      setError('');
      const [nextLeads, nextStats] = await Promise.all([api.listLeads(search), api.dashboard()]);
      setLeads(nextLeads); setStats(nextStats);
    } catch (caught) { setError(message(caught)); }
  }
  useEffect(() => { refresh(''); }, []);

  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await api.createLead(Object.fromEntries(new FormData(event.currentTarget))); event.currentTarget.reset(); setNotice('Lead added'); await refresh(); }
    catch (caught) { setError(message(caught)); }
  }
  async function importLeads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get('file');
      const hasFile = file instanceof File && file.size > 0;
      const csv = hasFile ? await file.text() : form.get('csv');
      const url = hasFile ? '' : form.get('url');
      const result = await api.importLeads(csv, url);
      setNotice('');
      setImportSummary(result);
      await refresh();
    }
    catch (caught) { setError(message(caught)); }
  }
  async function sendCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries(form.entries());
    payload.noFollowup = form.get('noFollowup') === 'true';
    payload.maxFollowups = Number(form.get('maxFollowups') || 0);
    try { const result = await api.sendCampaign(payload); setNotice(`Sent ${result.sent} email(s)`); await refresh(); }
    catch (caught) { setError(message(caught)); }
  }
  async function changed(nextNotice: string) { setNotice(nextNotice); await refresh(); }

  return <main>
    <nav><div className="brand">lead<span>desk</span></div><NavButton active={tab === 'leads'} onClick={() => setTab('leads')}>Leads</NavButton><NavButton active={tab === 'import'} onClick={() => setTab('import')}>Import</NavButton><NavButton active={tab === 'automation'} onClick={() => setTab('automation')}>Automation</NavButton></nav>
    <section className={selectedLead ? 'content details-visible' : 'content'}>
      <header><div><p className="eyebrow">OPERATIONS</p><h1>{tab === 'leads' ? 'Your lead pipeline' : tab === 'import' ? 'Import leads' : 'Email automation'}</h1></div><p className="notice">{notice}</p></header>
      {error && <div className="error-banner">{error}<button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {tab === 'import' && importSummary && <ImportSummaryPanel summary={importSummary} onDismiss={() => setImportSummary(null)}/>} 
      {tab === 'leads' && <LeadsTab stats={stats} query={query} setQuery={setQuery} onSearch={() => refresh()} onSubmit={addLead} leads={leads} onSelect={setSelectedLead}/>} 
      {tab === 'import' && <ImportTab onSubmit={importLeads}/>} 
      {tab === 'automation' && <AutomationTab leads={leads} onSubmit={sendCampaign}/>} 
    </section>
    {selectedLead && <LeadDetails lead={selectedLead} onClose={() => setSelectedLead(null)} onChanged={changed}/>} 
  </main>;
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) { return <button className={active ? 'active' : ''} onClick={onClick}>{children}</button>; }

function LeadsTab({ stats, query, setQuery, onSearch, onSubmit, leads, onSelect }: { stats: DashboardStats; query: string; setQuery: (value: string) => void; onSearch: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; leads: Lead[]; onSelect: (lead: Lead) => void }) {
  return <><div className="stats">{[['total', 'All leads'], ['emailed', 'Initial emails'], ['opened', 'Opened'], ['replied', 'Replied'], ['invalid', 'Invalid']].map(([key, label]) => <div className="card" key={key}><b>{stats[key as keyof DashboardStats]}</b><small>{label}</small></div>)}</div>
    <div className="toolbar"><input placeholder="Search email, phone or name" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && onSearch()}/><button onClick={onSearch}>Search</button></div>
    <form className="add" onSubmit={onSubmit}><input name="name" placeholder="Name"/><input name="email" type="email" placeholder="Email"/><input name="phone" placeholder="Phone"/><input name="category" placeholder="Category"/><input name="subcategory" placeholder="Subcategory"/><button>Add lead</button></form>
    <LeadTable leads={leads} onSelect={onSelect}/>
  </>;
}

function ImportSummaryPanel({ summary, onDismiss }: { summary: ImportSummary; onDismiss: () => void }) {
  const details = ([[summary.duplicates, 'duplicates'], [summary.empty, 'empty'], [summary.invalid, 'invalid']] as Array<[number, string]>).filter(([count]) => count > 0);

  return <aside className="import-summary" role="status" aria-live="polite" aria-atomic="true">
    <div className="summary-heading">
      <div className="summary-title"><span className="summary-status" aria-hidden="true">✓</span><div><span className="summary-kicker">IMPORT COMPLETE</span><h3>{summary.imported} of {summary.rows} rows added</h3></div></div>
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss import summary">×</button>
    </div>
    <div className="summary-stats">
      <div><b>{summary.imported}</b><span>Added</span></div>
      <div><b>{summary.skipped}</b><span>Skipped</span></div>
    </div>
    {details.length > 0 && <div className="summary-breakdown">{details.map(([count, label]) => <span key={label}><b>{count}</b> {label}</span>)}</div>}
  </aside>;
}

function ImportTab({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function selectFile(file: File | undefined) {
    if (file) { setSelectedFile(file); setFileName(file.name); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (selectedFile) {
      const input = event.currentTarget.elements.namedItem('file');
      if (input instanceof HTMLInputElement) {
        const transfer = new DataTransfer();
        transfer.items.add(selectedFile);
        input.files = transfer.files;
      }
    }
    onSubmit(event);
  }

  return <div className="import-page">
    <form className="import-form" onSubmit={submit}>
      <div className="import-sources">
        <section className="import-source"><div className="source-heading"><span>01</span><div><b>Upload CSV</b><small>From your device</small></div></div><label className={dragActive ? 'file-drop active' : 'file-drop'} onDragOver={event => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={event => { event.preventDefault(); setDragActive(false); selectFile(event.dataTransfer.files[0]); }}><input name="file" type="file" accept=".csv,text/csv" onChange={event => selectFile(event.target.files?.[0])}/><strong>{fileName || 'Choose a CSV file'}</strong><span>{fileName ? 'Ready' : 'or drop it here'}</span></label></section>
        <section className="import-source"><div className="source-heading"><span>02</span><div><b>Google Sheet</b><small>Published CSV URL</small></div></div><input name="url" type="url" placeholder="Paste published URL"/></section>
      </div>
      <section className="paste-source"><div className="source-heading"><span>03</span><div><b>Paste CSV</b><small>Headers in the first row</small></div></div><textarea name="csv" placeholder={'name,email,phone,category,subcategory\nAva,ava@example.com,555-0100,SaaS,HR'}/></section>
      <div className="import-footer"><p>Requires <code>email</code> or <code>phone</code>. Duplicates are skipped.</p><button>Import leads</button></div>
    </form>
  </div>;
}
function AutomationTab({ leads, onSubmit }: { leads: Lead[]; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const [mode, setMode] = useState<'initial' | 'followup'>('initial');
  const [category, setCategory] = useState('');
  const [before, setBefore] = useState('');
  const [noFollowup, setNoFollowup] = useState(false);
  const [maxFollowups, setMaxFollowups] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const categories = Array.from(new Set(leads.map(lead => lead.category).filter(Boolean))).sort();
  const eligible = leads.filter(lead => {
    if (lead.isInvalid || lead.replied || !lead.email) return false;
    if (mode === 'initial' ? lead.mailSent : !lead.mailSent) return false;
    if (category && lead.category !== category) return false;
    if (before && lead.createdAt.slice(0, 10) > before) return false;
    if (noFollowup && lead.anyFollowup) return false;
    if (mode === 'followup' && maxFollowups && lead.followupCount >= Number(maxFollowups)) return false;
    return true;
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    try { await onSubmit(event); } finally { setSending(false); }
  }

  return <div className="automation-page">
    <form className="automation-form" onSubmit={submit}>
      <section className="automation-section campaign-section"><div className="section-label"><span>01</span><b>Campaign type</b></div><div className="campaign-modes"><button type="button" className={mode === 'initial' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('initial')}><strong>Initial email</strong><span>Uncontacted leads</span></button><button type="button" className={mode === 'followup' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('followup')}><strong>Follow-up</strong><span>Non-replied leads</span></button></div><input type="hidden" name="mode" value={mode}/></section>
      <section className="automation-section"><div className="section-label"><span>02</span><b>Audience</b></div><div className="automation-table"><div className="automation-row automation-head"><span>Filter</span><span>Value</span><span>Meaning</span></div><div className="automation-row"><b>Category</b><select name="category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select><small>Only leads in this category</small></div><div className="automation-row"><b>Created before</b><input name="before" type="date" value={before} onChange={event => setBefore(event.target.value)}/><small>Leads created on or before this date</small></div>{mode === 'followup' && <div className="automation-row"><b>Follow-up limit</b><input name="maxFollowups" type="number" min="1" placeholder="No limit" value={maxFollowups} onChange={event => setMaxFollowups(event.target.value)}/><small>Exclude leads at this follow-up count</small></div>}<div className="automation-row"><b>No follow-up yet</b><label className="table-check"><input name="noFollowup" value="true" type="checkbox" checked={noFollowup} onChange={event => setNoFollowup(event.target.checked)}/><span>{noFollowup ? 'On' : 'Off'}</span></label><small>Exclude leads already followed up</small></div></div></section>
      <section className="automation-section composer-section"><div className="section-label"><span>03</span><b>Message</b></div><label>Subject<input required name="subject" value={subject} onChange={event => setSubject(event.target.value)} placeholder="Subject"/></label><label>Body<textarea required name="body" value={body} onChange={event => setBody(event.target.value)} placeholder="Write your message..."/><small className="character-count">{body.length}</small></label></section>
      <section className="send-review"><div><strong>{eligible.length} eligible {eligible.length === 1 ? 'lead' : 'leads'}</strong></div><button type="submit" disabled={sending || !eligible.length || !subject.trim() || !body.trim()}>{sending ? 'Sending...' : 'Send campaign'}</button></section>
    </form>
  </div>;
}
function message(error: unknown) { return error instanceof Error ? error.message : 'Request failed'; }
