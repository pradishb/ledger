import { useEffect, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { currencySymbol, errorMessage, parseMoney } from '../lib/format';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../lib/types';

/** Edit an account's name, type, group, opening balance and visibility. Currency can't change. */
export function AccountModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data, online, toast } = useLedger();
  const save = useLedgerMutation(api.updateAccount);
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [group, setGroup] = useState(account.group);
  // Keep the sign: an opening balance can be negative (cards, loans).
  const [opening, setOpening] = useState((account.opening / 100).toFixed(2));
  const [hidden, setHidden] = useState(account.hidden);
  const [err, setErr] = useState('');
  const groups = [...new Set(data.accounts.map(a => a.group).filter(Boolean))].sort((x, y) => x.localeCompare(y));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    if (data.accounts.some(a => a.id !== account.id && a.name.toLowerCase() === n.toLowerCase())) return setErr('Another account already has that name.');
    const cents = opening.trim() ? parseMoney(opening) : 0;
    if (!Number.isFinite(cents)) return setErr('Opening balance must be a number.');
    try {
      await save.mutateAsync({ id: account.id, name: n, type, group: group.trim(), opening: cents, hidden });
      toast(`Saved “${n}”`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <div className="scrim" onMouseDown={onClose}>
      <form className="sheet" style={{ width: 520 }} onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true"
        onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="sheet-head">
          <div className="t">Edit account</div>
          <button type="button" className="x" onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <div className="sheet-body">
          <div className="form-grid">
            <label className="field full">Name
              <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">Type
              <select className="select" value={type} onChange={e => setType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="field">Group
              <input className="input" value={group} onChange={e => setGroup(e.target.value)} placeholder="None" list="edit-account-groups" />
              <datalist id="edit-account-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
            </label>
            <label className="field">Opening balance
              <div className="amount-box">
                <span>{currencySymbol(account.currency)}</span>
                <input value={opening} onChange={e => setOpening(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </div>
            </label>
            <label className="field">Currency
              <input className="input" value={account.currency} disabled title="An account's currency can't be changed" />
            </label>
            <label className="field full check-field">
              <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />
              Hidden: left out of the Overview and new transactions, still counted in net worth
            </label>
          </div>
          {err && <div className="err">{err}</div>}
          {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
        </div>
        <div className="sheet-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending || !online}>Save</button>
        </div>
      </form>
    </div>
  );
}
