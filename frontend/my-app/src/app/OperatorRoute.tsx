import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { useAuth } from '@/shared/auth/AuthContext';

const OPERATOR_INTERFACE_PERMISSION = 'operator.interface.access';

export const OperatorRoute = () => {
  const { isLoggedIn, user } = useAuth();
  const navigate = useNavigate();
  const hasOperatorAccess = user?.permissions?.includes(OPERATOR_INTERFACE_PERMISSION) ?? false;
  const hasBackofficeAccess = user?.permissions?.includes('backoffice.access') ?? false;

  useEffect(() => {
    if (!isLoggedIn || hasOperatorAccess) {
      return;
    }

    toast.error('Accesso interfaccia operatore non consentito');
    navigate(hasBackofficeAccess ? '/admin' : '/admin-login', { replace: true });
  }, [hasBackofficeAccess, hasOperatorAccess, isLoggedIn, navigate]);

  if (isLoggedIn && !hasOperatorAccess) {
    return null;
  }

  return <Outlet />;
};
