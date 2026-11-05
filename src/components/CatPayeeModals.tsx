import { useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { errorMessage } from '../lib/format';
import { PALETTE, type CatType, type Category, type Payee } from '../lib/types';
import { Seg, SheetDialog } from './common';

/**
 * Add a category (no `category`) or edit one: its name, whether it's income or expense, and the
 * category it sits under. A top-level category's subcategories follow it to the other type.
 */
export function CategoryModal({ category, type: initialType, onClose }: { category?: Category; type: CatType; onClose: () => void }) {
  const { data, idx, online, toast } = useLedger();
  const add = useLedgerMutation(api.addCategory);
  const update = useLedgerMutation(api.updateCategory);
  const isNew = !category;
  const [name, setName] = useState(category?.name ?? '');
  const [type, setType] = useState<CatType>(category ? idx.catType(category.id) : initialType);
  const [parent, setParent] = useState(String(category?.parent ?? 0));
  const [err, setErr] = useState('');
  // A category with subcategories stays top level, since categories only go one level deep.
  const hasSubs = !!category && idx.subsOf(category.id).length > 0;
  const tops = idx.tops.filter(c => c.type === type && c.id !== category?.id);
  const busy = add.isPending || update.isPending;

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    const p = +parent;
    if (data.cats.some(c => c.id !== category?.id && (c.parent ?? 0) === p && idx.catType(c.id) === type && c.name.toLowerCase() === n.toLowerCase()))
      return setErr('A category with that name is already there.');
    // Top-level categories carry the colour; keep the one it has, or give it the next one.
    const color = p ? null : category?.color ?? PALETTE[idx.tops.length % PALETTE.length];
    try {
      if (category) {
        await update.mutateAsync({ id: category.id, name: n, parent: p, type, color });
        toast(`Saved “${n}”`);
      } else {
        await add.mutateAsync({ name: n, parent: p, type, color });
        toast(`Added “${n}”`);
      }
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <SheetDialog title={isNew ? 'New category' : 'Edit category'} width={440} onClose={onClose} onSubmit={submit}
      foot={<>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !online}>{isNew ? 'Add category' : 'Save'}</button>
      </>}>
      <div className="form-grid">
        <label className="field full">Name
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </label>
        <div className="field">Type
          <Seg className="md" value={type} onChange={k => { setType(k); setParent('0'); }}
            options={[['exp', 'Expense'], ['inc', 'Income']] as const} />
        </div>
        <label className="field">Under
          <select className="select" value={parent} onChange={e => setParent(e.target.value)} disabled={hasSubs}
            title={hasSubs ? 'It has subcategories, so it stays top level' : undefined}>
            <option value="0">Nothing (top level)</option>
            {tops.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {hasSubs && <div className="field full muted">Changing the type moves its subcategories with it.</div>}
      </div>
      {err && <div className="err">{err}</div>}
      {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
    </SheetDialog>
  );
}

/** Add a payee (no `payee`) or edit one: its name and the memo patterns that pick it for new transactions. */
export function PayeeModal({ payee, onClose }: { payee?: Payee; onClose: () => void }) {
  const { data, online, toast } = useLedger();
  const add = useLedgerMutation(api.addPayee);
  const update = useLedgerMutation(api.updatePayee);
  const isNew = !payee;
  const [name, setName] = useState(payee?.name ?? '');
  const [match, setMatch] = useState(payee?.match.join(', ') ?? '');
  const [err, setErr] = useState('');

  async function submit() {
    const n = name.trim();
    if (!n) return setErr('Enter a name.');
    if (data.payees.some(p => p.id !== payee?.id && p.name.toLowerCase() === n.toLowerCase())) return setErr('Another payee already has that name.');
    const m = [...new Set(match.split(',').map(x => x.trim()).filter(Boolean))];
    try {
      if (payee) {
        await update.mutateAsync({ id: payee.id, name: n, match: m });
        toast(`Saved “${n}”`);
      } else {
        await add.mutateAsync({ name: n, match: m });
        toast(`Added “${n}”`);
      }
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <SheetDialog title={isNew ? 'New payee' : 'Edit payee'} width={440} onClose={onClose} onSubmit={submit}
      foot={<>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={add.isPending || update.isPending || !online}>{isNew ? 'Add payee' : 'Save'}</button>
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
