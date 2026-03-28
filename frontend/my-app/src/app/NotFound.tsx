import { Link } from 'react-router';
import { AlertCircle } from 'lucide-react';

export function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-4xl mb-2">404</h1>
        <p className="text-gray-600 mb-4">Pagina non trovata</p>
        <Link to="/" className="text-blue-600 hover:underline">
          Torna alla home
        </Link>
      </div>
    </div>
  );
}
