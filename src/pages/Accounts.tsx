import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { CURRENCY_CODES, DEFAULT_CURRENCY } from '../data/rates';
import { Chevron, CurrencySelect, DisplayCurrency, Header, useOpenGroups } from '../components/ui';
import { accountGroups, balColor, sumBy } from '../lib/ledger';
import { errorMessage, fmt, parseMoney } from '../lib/format';
import { ACCOUNT_TYPES, type AccountType } from '../lib/types';

export function Accounts() {
  const { data, idx, bal, online, toast } = useLedger();
  const navigate = useNavigate();
  const add = useLedgerMutation(api.addAccount);
  const setCur = useLedgerMutation(api.setAccountCurrency);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [inst, setInst] = useState('');
  const [opening, setOpening] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  const groups = accountGroups(data.accounts, bal, idx);
  const { isOpen, toggle } = useOpenGroups();
  const total = sumBy(data.accounts, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const used = data.accounts.map(a => a.currency);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const cents = opening.trim() ? parseMoney(opening) : 0;
    if (!Number.isFinite(cents)) return toast('Opening balance must be a number');
    try {
      await add.mutateAsync({ name: name.trim(), type, institution: inst.trim(), opening: cents, currency });
      toast(`Added “${name.trim()}”`);
      setName(''); setInst(''); setOpening('');
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <>
      <Header title="Accounts" subtitle={`${data.accounts.length} accounts`}><DisplayCurrency /></Header>
      <div className="content">
        <div className="panel" style={{ maxWidth: 1320 }}>
          <form className="inline-form" onSubmit={submit}>
            <input className="input" style={{ width: 180 }} placeholder="Account name" value={name} onChange={e => setName(e.target.value)} />
            <select className="select" value={type} onChange={e => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="input" style={{ width: 180 }} placeholder="Institution (optional)" value={inst} onChange={e => setInst(e.target.value)} />
            <CurrencySelect value={currency} onChange={setCurrency} used={used} all={CURRENCY_CODES} title="Account currency" />
            <input className="input mono" style={{ width: 140, textAlign: 'right' }} placeholder="Opening balance" inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} />
            <button className="btn sm" disabled={!online || add.isPending || !name.trim()}>Add account</button>
            <span className="muted" style={{ fontSize: 12 }}>Enter amounts you owe (cards, loans) as negative.</span>
          </form>
          <table className="tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th className="hide-m">Institution</th>
                <th className="hide-m" style={{ width: 90 }}>Currency</th>
                <th className="r">Balance</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => [
                <tr className="group toggle" key={g.label} onClick={() => toggle(g.label)} aria-expanded={isOpen(g.label)}>
                  <td style={{ fontWeight: 600, color: 'var(--ink2)', fontSize: 11.5, paddingTop: 6, paddingBottom: 6 }}>
                    <Chevron open={isOpen(g.label)} />{g.label} <span className="muted" style={{ fontWeight: 400 }}>· {g.accounts.length}</span>
                  </td>
                  <td className="hide-m" />
                  <td className="hide-m" />
                  <td className="num" style={{ fontWeight: 600, color: balColor(g.balance) }}>{fmt(g.balance, idx.disp)}</td>
                </tr>,
                ...(isOpen(g.label) ? g.accounts : []).map(a => {
                  const b = bal.get(a.id) ?? 0;
                  const conv = idx.convert(b, a.currency, idx.disp);
                  return (
                    <tr className="clickable" key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                      <td style={{ paddingLeft: 28, paddingTop: 6, paddingBottom: 6 }}>{a.name}</td>
                      <td className="small muted hide-m">{a.institution}</td>
                      <td className="hide-m" onClick={e => e.stopPropagation()}>
                        <CurrencySelect className="select sm" value={a.currency} used={used} all={CURRENCY_CODES}
                          disabled={!online || setCur.isPending} title="The currency this account's amounts are in"
                          onChange={c => {
                            if (!confirm(`Change “${a.name}” to ${c}? Its amounts stay the same numbers, now read as ${c}.`)) return;
                            setCur.mutate({ id: a.id, currency: c }, { onError: err => toast(errorMessage(err)) });
                          }} />
                      </td>
                      <td className="num" style={{ color: balColor(b) }}>
                        {fmt(b, a.currency)}
                        {a.currency !== idx.disp && b !== 0 && (
                          <div className="small muted">{conv === null ? 'No rate, not in totals' : `≈ ${fmt(conv, idx.disp)}`}</div>
                        )}
                      </td>
                    </tr>
                  );
                }),
              ])}
              {data.accounts.length > 0 && (
                <tr className="group">
                  <td style={{ fontWeight: 600, paddingTop: 6, paddingBottom: 6 }}>Net worth</td>
                  <td className="hide-m" />
                  <td className="hide-m" />
                  <td className="num" style={{ fontWeight: 600, color: balColor(total) }}>
                    {fmt(total, idx.disp)}
                    {idx.unrated.length > 0 && <div className="small muted">{idx.unrated.join(', ')} not included: no rate</div>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!data.accounts.length && <div className="empty">No accounts yet. Add one above.</div>}
        </div>
      </div>
    </>
  );
}
