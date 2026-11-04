import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Column, ColumnDef, RowSelectionState, SortingState } from '@tanstack/react-table';
import { Eye, EyeOff, Pencil } from 'lucide-react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { DisplayCurrency, Header, Seg } from '../components/common';
import { AccountModal } from '../components/AccountModal';
import { DataTable } from '../components/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { balColor, sumBy } from '../lib/ledger';
import { errorMessage, fmt } from '../lib/format';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../lib/types';

type Show = 'visible' | 'hidden' | 'all';
interface Prefs { sort: SortingState; type: AccountType | ''; cur: string; show: Show }
const DEFAULT_PREFS: Prefs = { sort: [{ id: 'type', desc: false }], type: '', cur: '', show: 'visible' };
const TYPE_LABEL = new Map(ACCOUNT_TYPES);
const TYPE_ORDER = new Map(ACCOUNT_TYPES.map(([k], i) => [k, i]));
const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true });

export function Accounts() {
  const { data, idx, bal, online, toast, setNewShortcut } = useLedger();
  const navigate = useNavigate();
  const setHidden = useLedgerMutation(api.setAccountHidden);
  const bulk = useLedgerMutation(api.updateAccounts);
  const [selection, setSelection] = useState<RowSelectionState>({});
  // The account being edited, or 'new' while adding one.
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [q, setQ] = useState('');

  // N opens New account here instead of New transaction (but not over an open dialog).
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => {
    setNewShortcut(() => { if (!editingRef.current) setEditing('new'); });
    return () => setNewShortcut(null);
  }, [setNewShortcut]);

  const usedCurs = [...new Set(data.accounts.map(a => a.currency))].sort();
  const usedTypes = ACCOUNT_TYPES.filter(([k]) => data.accounts.some(a => a.type === k));
  const hiddenCount = data.accounts.filter(a => a.hidden).length;
  const disp = (a: Account) => idx.convert(bal.get(a.id) ?? 0, a.currency, idx.disp);

  const needle = q.trim().toLowerCase();
  const rows = data.accounts
    .filter(a => prefs.show === 'all' || (prefs.show === 'hidden') === a.hidden)
    .filter(a => !prefs.type || a.type === prefs.type)
    .filter(a => !prefs.cur || a.currency === prefs.cur)
    .filter(a => !needle || a.name.toLowerCase().includes(needle) || a.group.toLowerCase().includes(needle));

  // Only rows still on screen count as selected, so a filter never edits accounts you can't see.
  const sel = rows.filter(a => selection[a.id]);

  async function apply(patch: { hidden?: boolean; type?: AccountType; group?: string }, done: string) {
    if (!sel.length) return;
    try {
      await bulk.mutateAsync({ ids: sel.map(a => a.id), patch });
      toast(`${done} ${sel.length} account${sel.length === 1 ? '' : 's'}`);
      setSelection({});
    } catch (err) {
      toast(errorMessage(err));
    }
  }
  function setGroupFor() {
    const shared = new Set(sel.map(a => a.group));
    const v = prompt(`Group for ${sel.length} account${sel.length === 1 ? '' : 's'} (leave empty to clear):`, shared.size === 1 ? [...shared][0] : '');
    if (v !== null) apply({ group: v.trim() }, 'Updated');
  }
  function toggleHidden(a: Account) {
    setHidden.mutate({ id: a.id, hidden: !a.hidden }, {
      onSuccess: () => toast(a.hidden ? `Showing “${a.name}”` : `Hid “${a.name}”`),
      onError: err => toast(errorMessage(err)),
    });
  }

  const shownTotal = sumBy(rows, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const netWorth = sumBy(data.accounts, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const filtered = rows.length !== data.accounts.length;
  const anyFilter = !!(needle || prefs.type || prefs.cur || prefs.show !== 'visible');

  const columns: ColumnDef<Account, unknown>[] = [
    {
      id: 'name', header: 'Account', accessorFn: a => a.name, meta: { flex: true }, sortingFn: (x, y) => text(x.original.name, y.original.name),
      cell: ({ row: { original: a } }) => <>{a.name}{a.hidden && <span className="tag">Hidden</span>}</>,
    },
    {
      id: 'type', header: 'Type', size: 120, meta: { hideOnMobile: true, cellClass: 'text-xs' },
      accessorFn: a => TYPE_ORDER.get(a.type) ?? 0, cell: ({ row }) => TYPE_LABEL.get(row.original.type),
    },
    {
      id: 'group', header: 'Group', accessorFn: a => a.group, meta: { flex: true, hideOnMobile: true, cellClass: 'text-xs text-muted-foreground' },
      // Accounts with no group sort after those with one.
      sortingFn: (x, y) => (+!x.original.group - +!y.original.group) || text(x.original.group, y.original.group),
    },
    { id: 'cur', header: 'Currency', size: 90, accessorFn: a => a.currency, meta: { hideOnMobile: true, cellClass: 'font-mono text-xs' } },
    {
      // Largest first on the first click; accounts with no exchange rate always go last.
      id: 'bal', header: 'Balance', size: 190, sortDescFirst: true, sortUndefined: 'last',
      accessorFn: a => disp(a) ?? undefined,
      meta: { align: 'right', cellClass: 'num', cellStyle: a => ({ color: balColor(bal.get(a.id) ?? 0) }) },
      cell: ({ row: { original: a } }) => {
        const b = bal.get(a.id) ?? 0;
        const conv = idx.convert(b, a.currency, idx.disp);
        return <>
          {fmt(b, a.currency)}
          {a.currency !== idx.disp && b !== 0 && <div className="text-xs text-muted-foreground">{conv === null ? 'No rate, not in totals' : `≈ ${fmt(conv, idx.disp)}`}</div>}
        </>;
      },
    },
    {
      id: 'actions', header: '', size: 76, enableSorting: false, enableResizing: false, enableHiding: false, meta: { align: 'right' },
      cell: ({ row: { original: a } }) => (
        <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" title="Edit this account" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground" disabled={!online || setHidden.isPending}
            title={a.hidden ? 'Show this account' : 'Hide this account'} aria-label={a.hidden ? `Show ${a.name}` : `Hide ${a.name}`} onClick={() => toggleHidden(a)}>
            {a.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </div>
      ),
    },
  ];

  // Totals sit under Balance (wherever it's been moved); the label fills the columns on one side.
  const footRow = (cols: Column<Account, unknown>[], label: ReactNode, value: ReactNode, color: string) => {
    const at = cols.findIndex(c => c.id === 'bal');
    const before = cols.slice(0, Math.max(0, at)), after = cols.slice(at + 1);
    return (
      <TableRow>
        <TableCell />
        {before.length > 0 && <TableCell colSpan={before.length} className="font-semibold">{label}</TableCell>}
        {at >= 0 && <TableCell className="num font-semibold" style={{ color }}>{value}</TableCell>}
        {after.length > 0 && <TableCell colSpan={after.length} className="font-semibold">{before.length ? null : label}</TableCell>}
      </TableRow>
    );
  };

  return (
    <>
      <Header title="Accounts" subtitle={`${data.accounts.length} accounts${hiddenCount ? `, ${hiddenCount} hidden` : ''}`}
        primary={<Button onClick={() => setEditing('new')} disabled={!online}>New account<span className="kbd hide-m">N</span></Button>}>
        <DisplayCurrency />
      </Header>
      <div className="content">
        <div className="panel" style={{ maxWidth: 1320 }}>
          {sel.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-3.5 py-2 text-[12.5px]" role="toolbar" aria-label="Bulk edit">
              <b>{sel.length} selected</b>
              <Button variant="outline" size="sm" disabled={!online || bulk.isPending || sel.every(a => a.hidden)} onClick={() => apply({ hidden: true }, 'Hid')}>Hide</Button>
              <Button variant="outline" size="sm" disabled={!online || bulk.isPending || sel.every(a => !a.hidden)} onClick={() => apply({ hidden: false }, 'Showing')}>Show</Button>
              <select className="select" value="" disabled={!online || bulk.isPending} aria-label="Change type"
                onChange={e => e.target.value && apply({ type: e.target.value as AccountType }, `Set type to ${TYPE_LABEL.get(e.target.value as AccountType)} for`)}>
                <option value="">Change type…</option>
                {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <Button variant="outline" size="sm" disabled={!online || bulk.isPending} onClick={setGroupFor}>Set group…</Button>
              <span className="flex-1" />
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setSelection({})}>Clear selection</Button>
            </div>
          )}

          <DataTable id="accounts" data={rows} columns={columns} getRowId={a => String(a.id)}
            toolbar={<>
            <Input type="search" className="h-8 w-56" placeholder="Search accounts" value={q} onChange={e => setQ(e.target.value)} aria-label="Search accounts" />
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
              <Seg value={prefs.show} onChange={v => setPrefs({ show: v })}
                options={[['visible', 'Visible'], ['hidden', `Hidden${hiddenCount ? ` · ${hiddenCount}` : ''}`], ['all', 'All']] as const} />
              {anyFilter && (
                <Button variant="link" size="sm" className="h-auto px-0" onClick={() => { setQ(''); setPrefs({ type: '', cur: '', show: 'visible' }); }}>Clear filters</Button>
              )}
            </>}
            toolbarEnd={<span className="text-xs text-muted-foreground">{filtered ? `${rows.length} of ${data.accounts.length}` : `${rows.length} accounts`}</span>}
            sorting={prefs.sort} onSortingChange={s => setPrefs({ sort: s.length ? s : DEFAULT_PREFS.sort })}
            selection={selection} onSelectionChange={setSelection}
            onRowClick={a => navigate(`/transactions?account=${a.id}`)}
            rowClassName={a => (a.hidden ? 'text-muted-foreground' : '')}
            empty={data.accounts.length ? 'No accounts match these filters.' : 'No accounts yet. Use New account to add one.'}
            footer={data.accounts.length ? cols => <>
              {filtered && footRow(cols, 'Total shown', fmt(shownTotal, idx.disp), balColor(shownTotal))}
              {footRow(cols,
                <>Net worth <span className="text-xs font-normal text-muted-foreground">· all accounts</span></>,
                <>{fmt(netWorth, idx.disp)}{idx.unrated.length > 0 && <div className="text-xs text-muted-foreground">{idx.unrated.join(', ')} not included: no rate</div>}</>,
                balColor(netWorth))}
            </> : undefined} />
          {editing && <AccountModal account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
        </div>
      </div>
    </>
  );
}

const PREFS_KEY = 'ledger.accountsView';
const SORTABLE = ['name', 'type', 'group', 'cur', 'bal'];

/** Sort and filters for the accounts table, remembered per device (the search box isn't). */
function usePrefs() {
  const [p, setP] = useState<Prefs>(() => {
    try {
      const v = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
      // Older saves stored the sort as { sort: 'name', desc: true }.
      if (!Array.isArray(v.sort)) v.sort = typeof v.sort === 'string' ? [{ id: v.sort, desc: !!v.desc }] : DEFAULT_PREFS.sort;
      // Drop sorts on columns that no longer exist (the old Institution column, say).
      v.sort = v.sort.filter((x: { id: string }) => SORTABLE.includes(x.id));
      if (!v.sort.length) v.sort = DEFAULT_PREFS.sort;
      return v;
    } catch { return DEFAULT_PREFS; }
  });
  const set = (patch: Partial<Prefs>) => setP(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [p, set] as const;
}
