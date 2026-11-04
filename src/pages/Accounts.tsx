import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Header } from '../components/ui';
import { accountGroups, balColor, sumBy } from '../lib/ledger';
import { errorMessage, fmt, parseMoney } from '../lib/format';
import { ACCOUNT_TYPES, type AccountType } from '../lib/types';

export function Accounts() {
  const { data, bal, online, toast } = useLedger();
  const navigate = useNavigate();
  const add = useLedgerMutation(api.addAccount);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [inst, setInst] = useState('');
  const [opening, setOpening] = useState('');

  const groups = accountGroups(data.accounts, bal);
  const total = (f: 'today' | 'future') => sumBy(data.accounts, a => bal.get(a.id)?.[f] ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const cents = opening.trim() ? parseMoney(opening) : 0;
    if (!Number.isFinite(cents)) return toast('Opening balance must be a number');
    try {
      await add.mutateAsync({ name: name.trim(), type, institution: inst.trim(), opening: cents });
      toast(`Added “${name.trim()}”`);
      setName(''); setInst(''); setOpening('');
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  return (
    <>
      <Header title="Accounts" subtitle={`${data.accounts.length} accounts`} />
      <div className="content">
        <div className="panel" style={{ maxWidth: 1320 }}>
          <form className="inline-form" onSubmit={submit}>
            <input className="input" style={{ width: 180 }} placeholder="Account name" value={name} onChange={e => setName(e.target.value)} />
            <select className="select" value={type} onChange={e => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="input" style={{ width: 180 }} placeholder="Institution (optional)" value={inst} onChange={e => setInst(e.target.value)} />
            <input className="input mono" style={{ width: 140, textAlign: 'right' }} placeholder="Opening balance" inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} />
            <button className="btn sm" disabled={!online || add.isPending || !name.trim()}>Add account</button>
            <span className="muted" style={{ fontSize: 12 }}>Enter amounts you owe (cards, loans) as negative.</span>
          </form>
          <table className="tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th className="hide-m">Institution</th>
                <th className="r">Today</th>
                <th className="r">Future</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => [
                <tr className="group" key={g.label}>
                  <td style={{ fontWeight: 600, color: 'var(--ink2)', fontSize: 11.5, paddingTop: 6, paddingBottom: 6 }}>{g.label}</td>
                  <td className="hide-m" />
                  <td className="num" style={{ fontWeight: 600, color: balColor(g.today) }}>{fmt(g.today)}</td>
                  <td className="num" style={{ fontWeight: 600, color: balColor(g.future) }}>{fmt(g.future)}</td>
                </tr>,
                ...g.accounts.map(a => {
                  const b = bal.get(a.id) ?? { today: 0, future: 0 };
                  return (
                    <tr className="clickable" key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
                      <td style={{ paddingLeft: 28, paddingTop: 6, paddingBottom: 6 }}>{a.name}</td>
                      <td className="small muted hide-m">{a.institution}</td>
                      <td className="num" style={{ color: balColor(b.today) }}>{fmt(b.today)}</td>
                      <td className="num" style={{ color: balColor(b.future) }}>{fmt(b.future)}</td>
                    </tr>
                  );
                }),
              ])}
              {data.accounts.length > 0 && (
                <tr className="group">
                  <td style={{ fontWeight: 600, paddingTop: 6, paddingBottom: 6 }}>Net worth</td>
                  <td className="hide-m" />
                  <td className="num" style={{ fontWeight: 600, color: balColor(total('today')) }}>{fmt(total('today'))}</td>
                  <td className="num" style={{ fontWeight: 600, color: balColor(total('future')) }}>{fmt(total('future'))}</td>
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
