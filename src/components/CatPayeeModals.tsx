import { useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { errorMessage } from '../lib/format';
import { PALETTE, type CatType } from '../lib/types';
import { Seg, SheetDialog } from './common';

/** Add a category: its name, whether it's income or expense, and optionally the category it sits under. */
export function CategoryModal({ type: initialType, onClose }: { type: CatType; onClose: () => void }) {
  const { data, idx, online, toast } = useLedger();
  const add = useLedgerMutation(api.addCategory);
  const [name, setName] = useState('');
  const [type, setType] = useState<CatType>(initialType);
  const [parent, setParent] = useState('0');
  const [err, setErr] = useState('');
  const tops = idx.tops.filter(c => c.type === type);

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    const p = +parent;
    if (data.cats.some(c => (c.parent ?? 0) === p && idx.catType(c.id) === type && c.name.toLowerCase() === n.toLowerCase()))
      return setErr('A category with that name is already there.');
    try {
      await add.mutateAsync({ name: n, parent: p, type, color: p ? null : PALETTE[idx.tops.length % PALETTE.length] });
      toast(`Added “${n}”`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <SheetDialog title="New category" width={440} onClose={onClose} onSubmit={submit}
      foot={<>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={add.isPending || !online}>Add category</button>
      </>}>
      <div className="form-grid">
        <label className="field full">Name
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </label>
        <div className="field">Type
          <Seg className="md" value={type} onChange={k => { setType(k); setParent('0'); }} options={[['exp', 'Expense'], ['inc', 'Income']] as const} />
        </div>
        <label className="field">Under
          <select className="select" value={parent} onChange={e => setParent(e.target.value)}>
            <option value="0">Nothing (top level)</option>
            {tops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      {err && <div className="err">{err}</div>}
      {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
    </SheetDialog>
  );
}

/** Add a payee, with the memo patterns that pick it for new transactions. */
export function PayeeModal({ onClose }: { onClose: () => void }) {
  const { data, online, toast } = useLedger();
  const add = useLedgerMutation(api.addPayee);
  const [name, setName] = useState('');
  const [match, setMatch] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    if (data.payees.some(p => p.name.toLowerCase() === n.toLowerCase())) return setErr('That payee already exists.');
    try {
      await add.mutateAsync({ name: n, match: [...new Set(match.split(',').map(x => x.trim()).filter(Boolean))] });
      toast(`Added “${n}”`);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <SheetDialog title="New payee" width={440} onClose={onClose} onSubmit={submit}
      foot={<>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={add.isPending || !online}>Add payee</button>
      </>}>
      <div className="form-grid">
        <label className="field full">Name
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </label>
        <label className="field full">Matches memo
          <input className="input" value={match} onChange={e => setMatch(e.target.value)} placeholder="e.g. Coffee Ghar" />
        </label>
        <div className="field full muted">Optional. New transactions get this payee when their memo contains one of these (whole words, any case). Separate patterns with commas.</div>
      </div>
      {err && <div className="err">{err}</div>}
      {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
    </SheetDialog>
  );
}
