import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { CURRENCY_CODES, DEFAULT_CURRENCY } from '../data/rates';
import { CurrencySelect, DisplayCurrency, Header, Seg } from '../components/ui';
import { AccountModal } from '../components/AccountModal';
import { balColor, sumBy } from '../lib/ledger';
import { errorMessage, fmt, parseMoney } from '../lib/format';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../lib/types';

type SortKey = 'name' | 'type' | 'group' | 'cur' | 'bal';
type Show = 'visible' | 'hidden' | 'all';
interface Prefs { sort: SortKey; desc: boolean; type: AccountType | ''; cur: string; show: Show }
const DEFAULT_PREFS: Prefs = { sort: 'type', desc: false, type: '', cur: '', show: 'visible' };
const TYPE_LABEL = new Map(ACCOUNT_TYPES);
const TYPE_ORDER = new Map(ACCOUNT_TYPES.map(([k], i) => [k, i]));

export function Accounts() {
  const { data, idx, bal, online, toast } = useLedger();
  const navigate = useNavigate();
  const add = useLedgerMutation(api.addAccount);
  const setHidden = useLedgerMutation(api.setAccountHidden);
  const bulk = useLedgerMutation(api.updateAccounts);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Account | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [group, setGroup] = useState('');
  const [opening, setOpening] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  const used = data.accounts.map(a => a.currency);
  const usedCurs = [...new Set(used)].sort();
  const groupNames = [...new Set(data.accounts.map(a => a.group).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const usedTypes = ACCOUNT_TYPES.filter(([k]) => data.accounts.some(a => a.type === k));
  const hiddenCount = data.accounts.filter(a => a.hidden).length;
  const disp = (id: number) => idx.convert(bal.get(id) ?? 0, idx.accCur(id), idx.disp);

  const needle = q.trim().toLowerCase();
  const rows = data.accounts
    .filter(a => prefs.show === 'all' || (prefs.show === 'hidden') === a.hidden)
    .filter(a => !prefs.type || a.type === prefs.type)
    .filter(a => !prefs.cur || a.currency === prefs.cur)
    .filter(a => !needle || a.name.toLowerCase().includes(needle) || a.group.toLowerCase().includes(needle));

  const dir = prefs.desc ? -1 : 1;
  const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true });
  rows.sort((x, y) => {
    let c = 0;
    switch (prefs.sort) {
      case 'name': c = text(x.name, y.name); break;
      case 'type': c = (TYPE_ORDER.get(x.type) ?? 0) - (TYPE_ORDER.get(y.type) ?? 0); break;
      // Accounts with no group sort after those with one.
      case 'group': c = (+!x.group - +!y.group) || text(x.group, y.group); break;
      case 'cur': c = text(x.currency, y.currency); break;
      case 'bal': {
        // Accounts with no exchange rate can't be compared, so they go last either way.
        const bx = disp(x.id), by = disp(y.id);
        if (bx === null || by === null) return bx === by ? 0 : bx === null ? 1 : -1;
        c = bx - by; break;
      }
    }
    return c * dir || x.sort - y.sort || x.id - y.id;
  });

  // Only rows still on screen count as selected, so a filter never edits accounts you can't see.
  const sel = rows.filter(a => picked.has(a.id));
  const allPicked = rows.length > 0 && sel.length === rows.length;
  const togglePick = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(rows.map(a => a.id)));

  async function apply(patch: { hidden?: boolean; type?: AccountType; group?: string }, done: string) {
    if (!sel.length) return;
    try {
      await bulk.mutateAsync({ ids: sel.map(a => a.id), patch });
      toast(`${done} ${sel.length} account${sel.length === 1 ? '' : 's'}`);
      setPicked(new Set());
    } catch (err) {
      toast(errorMessage(err));
    }
  }
  function setGroupFor() {
    const shared = new Set(sel.map(a => a.group));
    const v = prompt(`Group for ${sel.length} account${sel.length === 1 ? '' : 's'} (leave empty to clear):`, shared.size === 1 ? [...shared][0] : '');
    if (v !== null) apply({ group: v.trim() }, 'Updated');
  }

  const shownTotal = sumBy(rows, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const netWorth = sumBy(data.accounts, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const filtered = rows.length !== data.accounts.length;
  const anyFilter = !!(needle || prefs.type || prefs.cur || prefs.show !== 'visible');

  // A new column sorts A to Z, except balance, which starts largest first.
  const sortBy = (k: SortKey) => setPrefs({ sort: k, desc: prefs.sort === k ? !prefs.desc : k === 'bal' });
  const th = (k: SortKey, label: string, className = '', style?: CSSProperties) => (
    <th className={`sortable ${className}`} style={style} aria-sort={prefs.sort === k ? (prefs.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => sortBy(k)}>
        {label}<span className="sort-ind" aria-hidden="true">{prefs.sort === k ? (prefs.desc ? '↓' : '↑') : ''}</span>
      </button>
    </th>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const cents = opening.trim() ? parseMoney(opening) : 0;
    if (!Number.isFinite(cents)) return toast('Opening balance must be a number');
    try {
      await add.mutateAsync({ name: name.trim(), type, group: group.trim(), opening: cents, currency });
      toast(`Added “${name.trim()}”`);
      setName(''); setGroup(''); setOpening('');
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <>
      <Header title="Accounts" subtitle={`${data.accounts.length} accounts${hiddenCount ? `, ${hiddenCount} hidden` : ''}`}>
        <DisplayCurrency />
      </Header>
      <div className="content">
        <div className="panel" style={{ maxWidth: 1320 }}>
          <form className="inline-form" onSubmit={submit}>
            <input className="input" style={{ width: 180 }} placeholder="Account name" value={name} onChange={e => setName(e.target.value)} />
            <select className="select" value={type} onChange={e => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="input" style={{ width: 180 }} placeholder="Group (optional)" value={group} onChange={e => setGroup(e.target.value)} list="account-groups" />
            <datalist id="account-groups">{groupNames.map(g => <option key={g} value={g} />)}</datalist>
            <CurrencySelect value={currency} onChange={setCurrency} used={used} all={CURRENCY_CODES} title="Account currency" />
            <input className="input mono" style={{ width: 140, textAlign: 'right' }} placeholder="Opening balance" inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} />
            <button className="btn sm" disabled={!online || add.isPending || !name.trim()}>Add account</button>
            <span className="muted" style={{ fontSize: 12 }}>Enter amounts you owe (cards, loans) as negative.</span>
          </form>

          {sel.length > 0 && (
            <div className="bulk-bar" role="toolbar" aria-label="Bulk edit">
              <b>{sel.length} selected</b>
              <button type="button" className="btn sm" disabled={!online || bulk.isPending || sel.every(a => a.hidden)} onClick={() => apply({ hidden: true }, 'Hid')}>Hide</button>
              <button type="button" className="btn sm" disabled={!online || bulk.isPending || sel.every(a => !a.hidden)} onClick={() => apply({ hidden: false }, 'Showing')}>Show</button>
              <select className="select" value="" disabled={!online || bulk.isPending} aria-label="Change type"
                onChange={e => e.target.value && apply({ type: e.target.value as AccountType }, `Set type to ${TYPE_LABEL.get(e.target.value as AccountType)} for`)}>
                <option value="">Change type…</option>
                {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="button" className="btn sm" disabled={!online || bulk.isPending} onClick={setGroupFor}>Set group…</button>
              <span className="spacer" />
              <button type="button" className="link" onClick={() => setPicked(new Set())}>Clear selection</button>
            </div>
          )}

          <div className="filter-bar">
            <input className="input search" type="search" placeholder="Search accounts" value={q} onChange={e => setQ(e.target.value)} aria-label="Search accounts" />
            <select className="select" value={prefs.type} onChange={e => setPrefs({ type: e.target.value as AccountType | '' })} aria-label="Type">
              <option value="">All types</option>
              {usedTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {usedCurs.length > 1 && (
              <select className="select" value={prefs.cur} onChange={e => setPrefs({ cur: e.target.value })} aria-label="Currency">
                <option value="">All currencies</option>
                {usedCurs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <Seg className="md" value={prefs.show} onChange={v => setPrefs({ show: v })}
              options={[['visible', 'Visible'], ['hidden', `Hidden${hiddenCount ? ` · ${hiddenCount}` : ''}`], ['all', 'All']] as const} />
            {anyFilter && (
              <button type="button" className="link" onClick={() => { setQ(''); setPrefs({ type: '', cur: '', show: 'visible' }); }}>Clear filters</button>
            )}
            <span className="spacer" />
            <span className="muted small">{filtered ? `${rows.length} of ${data.accounts.length}` : `${rows.length} accounts`}</span>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th className="pick">
                  <input type="checkbox" checked={allPicked} ref={el => { if (el) el.indeterminate = sel.length > 0 && !allPicked; }}
                    onChange={pickAll} aria-label={allPicked ? 'Select none' : 'Select all shown'} disabled={!rows.length} />
                </th>
                {th('name', 'Account')}
                {th('type', 'Type', 'hide-m', { width: 120 })}
                {th('group', 'Group', 'hide-m')}
                {th('cur', 'Currency', 'hide-m', { width: 90 })}
                {th('bal', 'Balance', 'r')}
                <th style={{ width: 72 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const b = bal.get(a.id) ?? 0;
                const conv = idx.convert(b, a.currency, idx.disp);
                return (
                  <tr className={`clickable${a.hidden ? ' is-hidden' : ''}${picked.has(a.id) ? ' picked' : ''}`} key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                    <td className="pick" onClick={e => { e.stopPropagation(); togglePick(a.id); }}>
                      <input type="checkbox" checked={picked.has(a.id)} onChange={() => togglePick(a.id)} onClick={e => e.stopPropagation()} aria-label={`Select ${a.name}`} />
                    </td>
                    <td>{a.name}{a.hidden && <span className="tag">Hidden</span>}</td>
                    <td className="small hide-m">{TYPE_LABEL.get(a.type)}</td>
                    <td className="small muted hide-m">{a.group}</td>
                    <td className="small mono hide-m">{a.currency}</td>
                    <td className="num" style={{ color: balColor(b) }}>
                      {fmt(b, a.currency)}
                      {a.currency !== idx.disp && b !== 0 && (
                        <div className="small muted">{conv === null ? 'No rate, not in totals' : `≈ ${fmt(conv, idx.disp)}`}</div>
                      )}
                    </td>
                    <td className="r row-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="icon-btn" title="Edit this account" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                        <PencilIcon />
                      </button>
                      <button type="button" className="icon-btn eye" disabled={!online || setHidden.isPending}
                        title={a.hidden ? 'Show this account' : 'Hide this account'} aria-label={a.hidden ? `Show ${a.name}` : `Hide ${a.name}`}
                        onClick={() => setHidden.mutate({ id: a.id, hidden: !a.hidden }, {
                          onSuccess: () => toast(a.hidden ? `Showing “${a.name}”` : `Hid “${a.name}”`),
                          onError: err => toast(errorMessage(err)),
                        })}>
                        <EyeIcon off={a.hidden} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {data.accounts.length > 0 && (
              <tfoot>
                {filtered && (
                  <tr className="group">
                    <td className="pick" />
                    <td style={{ fontWeight: 600 }}>Total shown</td>
                    <td className="hide-m" /><td className="hide-m" /><td className="hide-m" />
                    <td className="num" style={{ fontWeight: 600, color: balColor(shownTotal) }}>{fmt(shownTotal, idx.disp)}</td>
                    <td />
                  </tr>
                )}
                <tr className="group">
                  <td className="pick" />
                  <td style={{ fontWeight: 600 }}>Net worth <span className="muted small" style={{ fontWeight: 400 }}>· all accounts</span></td>
                  <td className="hide-m" /><td className="hide-m" /><td className="hide-m" />
                  <td className="num" style={{ fontWeight: 600, color: balColor(netWorth) }}>
                    {fmt(netWorth, idx.disp)}
                    {idx.unrated.length > 0 && <div className="small muted">{idx.unrated.join(', ')} not included: no rate</div>}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {!data.accounts.length && <div className="empty">No accounts yet. Add one above.</div>}
          {data.accounts.length > 0 && !rows.length && <div className="empty">No accounts match these filters.</div>}
          {editing && <AccountModal account={editing} onClose={() => setEditing(null)} />}
        </div>
      </div>
    </>
  );
}

const PREFS_KEY = 'ledger.accountsView';

/** Sort and filters for the accounts table, remembered per device (the search box isn't). */
function usePrefs() {
  const [p, setP] = useState<Prefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return DEFAULT_PREFS; }
  });
  const set = (patch: Partial<Prefs>) => setP(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [p, set] as const;
}

const EyeIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
    {off && <path d="M2.5 2.5l11 11" />}
  </svg>
);

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.5 2.5l3 3L5.5 13.5H2.5v-3z" /><path d="M9 4l3 3" />
  </svg>
);
