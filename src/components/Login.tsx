import { useState, type FormEvent } from 'react';
import { supabase } from '../data/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message);
  }

  return (
    <div className="center-screen">
      <form className="panel login" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="logo">L</div>Ledger</div>
        <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <div className="err" style={{ margin: 0 }}>{err}</div>}
        <button className="btn-primary" style={{ justifyContent: 'center', height: 34 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
