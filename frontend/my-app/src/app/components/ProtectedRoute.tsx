// frontend/my-app/src/app/components/ProtectedRoute.tsx

import { useAuth } from '@/app/AuthContext';
import { useEffect } from 'react';
import { useNavigate, Outlet } from 'react-router';
import { toast } from 'sonner';

export const ProtectedRoute = () => {
  const { isLoggedIn, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/admin-login', { replace: true });
      return;
    }

    if (!isAdmin) {
      toast.error('Accesso admin richiesto');
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, isAdmin, navigate]);

  // Se l'utente è admin, mostra il contenuto
  if (isLoggedIn && isAdmin) {
    return <Outlet />;
  }

  // Altrimenti mostra nothing while redirecting
  return null;
};
