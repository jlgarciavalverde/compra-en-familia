import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./lib/auth";
import { Shell } from "./components/shell";
import { Spinner } from "./components/ui";
import { JoinPage, LoginPage, ResetPage } from "./pages/auth";
import { HistoryPage } from "./pages/history";
import { ListPage } from "./pages/list";
import { ListsPage } from "./pages/lists";
import { ComparePage } from "./pages/prices";
import { SettingsPage } from "./pages/settings";
import { ShopPickPage, StorePage } from "./pages/store";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/entrar" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/unirse/:code" element={<JoinPage />} />
      <Route path="/restablecer/:code" element={<ResetPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<ListsPage />} />
        <Route path="listas/:id" element={<ListPage />} />
        <Route path="listas/:id/precios" element={<ComparePage />} />
        <Route path="comprar" element={<ShopPickPage />} />
        <Route path="comprar/:id" element={<StorePage />} />
        <Route path="historial" element={<HistoryPage />} />
        <Route path="ajustes" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
