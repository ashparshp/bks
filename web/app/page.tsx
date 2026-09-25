'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LeadDetails } from '../components/LeadDetails';
import { LeadTable } from '../components/LeadTable';
import { api } from '../lib/api';
import type { DashboardStats, Lead } from '../lib/types';

type Tab = 'leads' | 'import' | 'automation';
const emptyStats: DashboardStats = { total: 0, emailed: 0, opened: 0, replied: 0, invalid: 0 };

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [tab, setTab] = useState<Tab>('leads');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
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
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const file = form.get('file');
    const csv = file instanceof File && file.size > 0 ? await file.text() : form.get('csv');
    const url = file instanceof File && file.size > 0 ? '' : form.get('url');
    try { const result = await api.importLeads(csv, url); setNotice(`Imported ${result.imported} leads`); await refresh(); }
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
      <header><div><p className="eyebrow">OPERATIONS</p><h1>{tab === 'leads' ? 'Your lead pipeline' : tab === 'import' ? 'Bring in new leads' : 'Email automation'}</h1></div><p className="notice">{notice}</p></header>
      {error && <div className="error-banner">{error}<button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {tab === 'leads' && <LeadsTab stats={stats} query={query} setQuery={setQuery} onSearch={() => refresh()} onSubmit={addLead} leads={leads} onSelect={setSelectedLead}/>} 
      {tab === 'import' && <ImportTab onSubmit={importLeads}/>} 
      {tab === 'automation' && <AutomationTab onSubmit={sendCampaign}/>} 
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

function ImportTab({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <div className="panel"><h2>Import leads</h2><p>Choose a CSV file from your device, paste CSV content, or use a published Google Sheets CSV link. Duplicates by email or phone are skipped.</p><form onSubmit={onSubmit}><input name="file" type="file" accept=".csv,text/csv"/><input name="url" type="url" placeholder="Published Google Sheets CSV URL"/><textarea name="csv" placeholder={'Or paste CSV here\nname,email,phone,category,subcategory\nAva,ava@example.com,555-0100,SaaS,HR'}/><button>Import leads</button></form></div>; }
function AutomationTab({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <div className="panel"><h2>Send a campaign</h2><p>Initial sends target uncontacted valid leads. Follow-ups target valid leads that were emailed but have not replied.</p><form onSubmit={onSubmit}><select name="mode"><option value="initial">Initial email</option><option value="followup">Follow-up email</option></select><input name="category" placeholder="Optional category filter"/><input name="before" type="date"/><label className="check"><input name="noFollowup" value="true" type="checkbox"/> Only leads with no follow-up</label><input name="maxFollowups" type="number" min="0" placeholder="Maximum follow-ups per lead"/><input required name="subject" placeholder="Email subject"/><textarea required name="body" placeholder="Write your email…"/><button>Send now</button></form><p className="muted">Without Resend credentials, sends are safely simulated and recorded locally.</p></div>; }
function message(error: unknown) { return error instanceof Error ? error.message : 'Request failed'; }
