// app/operator/dashboard/page.tsx
"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OperatorDashboard() {
  const { user, machine, isAuthenticated, isLoading, logout } = useAuth();
  const router = useRouter();

  // Redirect se non autenticato
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/operator/login");
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-gray-600">Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!user || !machine) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold">D</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">DITTO</h1>
              <p className="text-sm text-gray-600">{machine.nome}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <p className="font-medium text-gray-800">{user.nome}</p>
              <p className="text-sm text-gray-600">{user.livello_esperienza}</p>
            </div>
            <button
              onClick={() => logout()}
              className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Avatar e area interazione vocale */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Avatar - col sinistro */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg p-6 text-center">
              <div className="w-64 h-64 mx-auto bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <span className="text-4xl text-gray-400">🧑</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-gray-600">In ascolto</span>
                </div>
                <p className="text-gray-500 text-sm">
                  Pronuncia "Ehi Ditto" per iniziare
                </p>
              </div>
            </div>
          </div>

          {/* Area informazioni - col destro */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                Benvenuto, {user.nome}
              </h2>

              {/* Info macchina */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-gray-700 mb-2">
                  Macchina assegnata
                </h3>
                <p className="text-gray-800">{machine.nome}</p>
                <p className="text-sm text-gray-500">{machine.reparto}</p>
                <p className="text-sm text-gray-500 mt-2">
                  {machine.descrizione}
                </p>
              </div>

              {/* Stato postazione */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <h3 className="font-medium text-gray-700 mb-2">
                  Stato postazione
                </h3>
                <p className="text-green-600 font-medium">
                  Occupata da {user.nome}
                </p>
                <p className="text-sm text-gray-500">Turno: {user.turno}</p>
              </div>

              {/* Suggerimenti vocali */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="font-medium text-blue-800 mb-2">
                  Cosa posso fare per te?
                </h3>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• "Come cambio l'olio?"</li>
                  <li>• "La pressa fa un rumore strano"</li>
                  <li>• "Mostrami i controlli obbligatori"</li>
                  <li>• "Fine turno"</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
