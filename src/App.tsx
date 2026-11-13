import { createBrowserRouter, createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { useData } from '@/data/DataProvider';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { PrintPage } from '@/features/print/PrintPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/users/UsersPage';

function Guard({ need, children }: { need: 'edit' | 'admin'; children: React.ReactNode }) {
  const { can } = useData();
  return can[need] ? <>{children}</> : <Navigate to="/" replace />;
}

const routes = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'escalas', element: <SchedulePage /> },
      { path: 'colaboradores', element: <EmployeesPage /> },
      { path: 'frequencia', element: <ReportsPage /> },
      { path: 'impressao', element: <PrintPage /> },
      { path: 'configuracoes', element: <Guard need="edit"><SettingsPage /></Guard> },
      { path: 'historico', element: <Guard need="edit"><HistoryPage /></Guard> },
      { path: 'usuarios', element: <Guard need="admin"><UsersPage /></Guard> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

// Hash router no modo demonstração (funciona em qualquer hospedagem estática); rotas limpas em produção.
const router = (import.meta.env.VITE_DATA_MODE === 'demo' ? createHashRouter : createBrowserRouter)(routes);

export default function App() {
  const { authChecked, profile, snapshot, loadError, reload } = useData();
  if (!authChecked || (profile && !snapshot && !loadError)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-forest-700"><Leaf className="h-6 w-6 animate-pulse" /><span className="font-semibold">Carregando escalas…</span></div>
      </div>
    );
  }
  if (!profile) return <LoginPage />;
  if (loadError && !snapshot) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-bold">Não foi possível carregar os dados</p>
        <p className="max-w-md text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={reload}>Tentar novamente</Button>
      </div>
    );
  }
  return <RouterProvider router={router} />;
}
