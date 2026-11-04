import { Link } from 'react-router';
import { useLedger } from '../data/context';
import { Header, Seg } from '../components/ui';

/** Phone-only overflow menu for the pages that don't fit in the tab bar. */
export function More() {
  const { theme, setTheme, signOut } = useLedger();
  return (
    <>
      <Header title="More" />
      <div className="content">
        <div className="stack">
          <div className="panel more-list">
            <Link to="/trend">Trend over time</Link>
            <Link to="/categories">Categories & payees</Link>
          </div>
          <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="muted">Appearance</span>
            <Seg className="md" value={theme} onChange={setTheme} options={[['light', 'Light'], ['dark', 'Dark']] as const} />
          </div>
          <button className="btn danger" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </>
  );
}
