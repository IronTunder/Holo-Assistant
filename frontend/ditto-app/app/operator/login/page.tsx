// app/operator/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const [badgeId, setBadgeId] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await login(badgeId);

      // Se il login è riuscito, reindirizza alla dashboard
      if (response.user && response.machine) {
        router.push("/operator/dashboard");
      }
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError("Errore di connessione. Verifica che il server sia attivo.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Simula la lettura del badge (per test senza lettore fisico)
  const simulateBadgeScan = () => {
    // Inserisci un badge ID di esempio (deve esistere nel database)
    setBadgeId("NFT-001");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md w-full">
        {/* Logo e titolo */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 mx-auto bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <span className="text-white text-3xl font-bold">D</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">DITTO</h1>
          <p className="text-gray-600">Assistente Olografico</p>
        </div>

        {/* Form di login */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Badge RFID / Codice Operatore
            </label>
            <input
              type="text"
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              placeholder="NFT-001"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !badgeId}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isLoading ? "Verifica in corso..." : "Avvicina il badge"}
          </button>

          {/* Pulsante per test (solo sviluppo) */}
          <button
            type="button"
            onClick={simulateBadgeScan}
            className="w-full text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Simula lettura badge (test)
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>Avvicina il badge al lettore RFID</p>
          <p className="mt-1">o inserisci il codice manualmente</p>
        </div>
      </div>
    </div>
  );
}
