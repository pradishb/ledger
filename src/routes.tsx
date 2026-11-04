import { Navigate, Route, Routes, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Accounts } from './pages/Accounts';
import { Register } from './pages/Register';
import { Stats } from './pages/Stats';
import { Trend } from './pages/Trend';
import { CategoriesPayees } from './pages/CategoriesPayees';
import { More } from './pages/More';

/** Old /accounts/:id links now open the Transactions page filtered to that account. */
function AccountRedirect() {
  const { id } = useParams();
  return <Navigate to={`/transactions?account=${id}`} replace />;
}

/** Every page of the signed-in app. Shared by the real entry point and the dev preview. */
export function AppRoutes({ onSignOut, email }: { onSignOut: () => void; email: string }) {
  return (
    <Routes>
      <Route element={<Layout onSignOut={onSignOut} email={email} />}>
        <Route index element={<Overview />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="accounts/:id" element={<AccountRedirect />} />
        <Route path="transactions" element={<Register />} />
        <Route path="stats" element={<Stats />} />
        <Route path="trend" element={<Trend />} />
        <Route path="categories" element={<CategoriesPayees />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
