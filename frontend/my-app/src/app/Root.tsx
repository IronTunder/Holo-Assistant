import { Outlet } from 'react-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/shared/auth/AuthContext';

export function Root() {
  const { restoreSession } = useAuth();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Ripristina la sessione all'avvio dell'app
    const initializeAuth = async () => {
      try {
        await restoreSession();
      } catch (error) {
        console.error('Errore durante l\'inizializzazione della sessione:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeAuth();
  }, [restoreSession]);

  // Mostra uno schermo di caricamento mentre verifichiamo la sessione
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Caricamento in corso...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <Outlet />
    </div>
  );
}
