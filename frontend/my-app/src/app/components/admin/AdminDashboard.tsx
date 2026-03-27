// frontend/my-app/src/app/components/admin/AdminDashboard.tsx

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { LogOut, Users, Cpu, Lock, LogsIcon, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { UserList } from './UserList';
import { MachineList } from './MachineList';
import { RoleManager } from './RoleManager';
import { LogViewer } from './LogViewer';
import { SettingsPanel } from './SettingsPanel';

export const AdminDashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('users');

  const handleLogout = async () => {
    await logout();
    navigate('/admin-login', { replace: true });
    toast.success('Logout effettuato');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
              <p className="text-sm text-slate-500">Gestione sistema</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-slate-900">{user?.nome}</p>
                <p className="text-xs text-slate-500">Amministratore</p>
              </div>
              <Button
                onClick={handleLogout}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto">
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Utenti</span>
            </TabsTrigger>
            <TabsTrigger value="machines" className="gap-2">
              <Cpu className="w-4 h-4" />
              <span className="hidden sm:inline">Macchinari</span>
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">Ruoli</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2">
              <LogsIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Log</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Impostazioni</span>
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Gestione Utenti</h2>
              <p className="text-sm text-slate-600 mb-4">
                Crea, modifica ed elimina utenti del sistema
              </p>
            </div>
            <UserList />
          </TabsContent>

          {/* Machines Tab */}
          <TabsContent value="machines" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Gestione Macchinari</h2>
              <p className="text-sm text-slate-600 mb-4">
                Crea, modifica ed elimina macchinari disponibili
              </p>
            </div>
            <MachineList />
          </TabsContent>

          {/* Roles Tab */}
          <TabsContent value="roles" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Gestione Ruoli</h2>
              <p className="text-sm text-slate-600 mb-4">
                Visualizza e gestisci i ruoli del sistema
              </p>
            </div>
            <RoleManager />
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Log di Audit</h2>
              <p className="text-sm text-slate-600 mb-4">
                Visualizza la cronologia delle interazioni nel sistema
              </p>
            </div>
            <LogViewer />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Impostazioni</h2>
              <p className="text-sm text-slate-600 mb-4">
                Configura i parametri di sistema
              </p>
            </div>
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
