import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/admin/Login';
import Register from './pages/admin/Register';
import Onboarding from './pages/admin/Onboarding';
import Dashboard from './pages/admin/Dashboard';
import Home from './pages/public/Home';
import ClubBooking from './pages/public/ClubBooking';

// Rutas protegidas para el administrador
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando sistema...</div>;
  if (!user) return <Navigate to="/admin" />;
  return <>{children}</>;
};

function App() {
  return (
    <Routes>
      {/* Rutas Públicas de Cliente */}
      <Route path="/" element={<Home />} />
      <Route path="/reserva/:id" element={<ClubBooking />} />

      {/* Rutas de Administrador - Públicas */}
      <Route path="/admin" element={<Login />} />
      <Route path="/admin/register" element={<Register />} />

      {/* Rutas de Administrador - Privadas */}
      <Route path="/admin/onboarding" element={
        <AdminRoute><Onboarding /></AdminRoute>
      } />
      <Route path="/admin/dashboard" element={
        <AdminRoute><Dashboard /></AdminRoute>
      } />
    </Routes>
  );
}

export default App;
