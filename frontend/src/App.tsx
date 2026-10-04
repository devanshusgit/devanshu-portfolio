import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "@/api/client";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingBlock } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs, usePrefsEffects } from "@/lib/prefs";

const Landing = lazy(() => import("@/pages/Landing"));
const Login = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Lab = lazy(() => import("@/pages/Lab"));
const DataStudio = lazy(() => import("@/pages/DataStudio"));
const SensorSimulator = lazy(() => import("@/pages/SensorSimulator"));
const History = lazy(() => import("@/pages/History"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const ModelLab = lazy(() => import("@/pages/ModelLab"));
const Experiments = lazy(() => import("@/pages/Experiments"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const Admin = lazy(() => import("@/pages/Admin"));
const SceneTest = import.meta.env.DEV ? lazy(() => import("@/pages/SceneTest")) : null;

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user?.role !== "ADMIN") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Loads the signed-in user's server-side settings once per session. */
function SessionBootstrap() {
  const token = useAuth((s) => s.token);
  const setUser = useAuth((s) => s.setUser);
  const hydrate = usePrefs((s) => s.hydrate);
  const settings = useQuery({ queryKey: ["settings", token], queryFn: api.settings, enabled: !!token, staleTime: Infinity });
  const me = useQuery({ queryKey: ["me", token], queryFn: api.me, enabled: !!token, staleTime: 60000 });
  useEffect(() => {
    if (settings.data) hydrate(settings.data.user);
  }, [settings.data, hydrate]);
  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data, setUser]);
  return null;
}

export default function App() {
  usePrefsEffects();
  return (
    <>
      <SessionBootstrap />
      <Suspense fallback={<LoadingBlock label="Loading NeuroGrip…" className="m-6 min-h-[60vh]" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/data-studio" element={<DataStudio />} />
            <Route path="/simulator" element={<SensorSimulator />} />
            <Route path="/experiments" element={<Experiments />} />
            <Route path="/history" element={<History />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/model" element={<ModelLab />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/admin"
              element={
                <RequireAuth admin>
                  <Admin />
                </RequireAuth>
              }
            />
          </Route>
          {SceneTest && <Route path="/_scene-test" element={<SceneTest />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
