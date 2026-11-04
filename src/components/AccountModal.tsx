import { useEffect, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { CURRENCY_CODES, DEFAULT_CURRENCY } from '../data/rates';
import { currencySymbol, errorMessage, parseMoney } from '../lib/format';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../lib/types';
import { CurrencySelect } from './ui';

/**
 * Add an account (no `account`), or edit one: name, type, group, opening balance and visibility.
 * Currency is picked once, when adding, and can't change afterwards.
 */
export function AccountModal({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { data, online, toast } = useLedger();
  const update = useLedgerMutation(api.updateAccount);
  const add = useLedgerMutation(api.addAccount);
  const isNew = !account;
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank');
  const [group, setGroup] = useState(account?.group ?? '');
  // Keep the sign: an opening balance can be negative (cards, loans).
  const [opening, setOpening] = useState(account ? (account.opening / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(account?.currency ?? DEFAULT_CURRENCY);
  const [hidden, setHidden] = useState(account?.hidden ?? false);
  const [err, setErr] = useState('');
  const groups = [...new Set(data.accounts.map(a => a.group).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const busy = update.isPending || add.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    if (data.accounts.some(a => a.id !== account?.id && a.name.toLowerCase() === n.toLowerCase())) return setErr('Another account already has that name.');
    const cents = opening.trim() ? parseMoney(opening) : 0;
    if (!Number.isFinite(cents)) return setErr('Opening balance must be a number.');
    try {
      if (account) {
        await update.mutateAsync({ id: account.id, name: n, type, group: group.trim(), opening: cents, hidden });
        toast(`Saved “${n}”`);
      } else {
        await add.mutateAsync({ name: n, type, group: group.trim(), opening: cents, currency });
        toast(`Added “${n}”`);
      }
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
          <div className="t">{isNew ? 'New account' : 'Edit account'}</div>
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
              <input className="input" value={group} onChange={e => setGroup(e.target.value)} placeholder="None" list="account-modal-groups" />
              <datalist id="account-modal-groups">{groups.map(g => <option key={g} value={g} />)}</datalist>
            </label>
            <label className="field">Currency
              {isNew
                ? <CurrencySelect value={currency} onChange={setCurrency} used={data.accounts.map(a => a.currency)} all={CURRENCY_CODES} title="Can't be changed later" />
                : <input className="input" value={currency} disabled title="An account's currency can't be changed" />}
            </label>
            <label className="field">Opening balance
              <div className="amount-box">
                <span>{currencySymbol(currency)}</span>
                <input value={opening} onChange={e => setOpening(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </div>
            </label>
            {isNew ? (
              <div className="field full muted">Enter amounts you owe (cards, loans) as negative. The currency can't be changed later.</div>
            ) : (
              <label className="field full check-field">
                <input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />
                Hidden: left out of the Overview and new transactions, still counted in net worth
              </label>
            )}
          </div>
          {err && <div className="err">{err}</div>}
          {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
        </div>
        <div className="sheet-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !online}>{isNew ? 'Add account' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
