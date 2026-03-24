// frontend/my-app/src/app/components/admin/AdminLogin.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { AlertCircle, Lock } from 'lucide-react';
import { toast } from 'sonner';

export const AdminLogin = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { adminLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    if (!username || !password) {
      setError('Inserisci username e password');
      setIsLoading(false);
      return;
    }

    const result = await adminLogin(username, password);

    if (result.success) {
      toast.success('Login admin effettuato con successo');
      navigate('/admin', { replace: true });
    } else {
      setError(result.error || 'Errore durante il login');
      toast.error(result.error || 'Credenziali non valide');
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
          <div className="flex items-center justify-center mb-2">
            <Lock className="w-8 h-8" />
          </div>
          <CardTitle className="text-2xl text-center">Admin Panel</CardTitle>
          <CardDescription className="text-blue-100 text-center">
            Accedi con le credenziali di amministratore
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                type="text"
                placeholder="Inserisci username admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Inserisci password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? 'Login in corso...' : 'Accedi'}
            </Button>
          </form>

          <div className="pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate('/', { replace: true })}
            >
              Torna alla pagina operatore
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
