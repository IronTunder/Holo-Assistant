import { MonitorCog, Mic, Sparkles } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Switch } from '@/shared/ui/switch';

import type { OperatorDisplayPreferences } from './operatorDisplayPreferences';

type OperatorSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: OperatorDisplayPreferences;
  onPreferencesChange: (preferences: OperatorDisplayPreferences) => void;
};

type SettingRowProps = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon: typeof Sparkles;
};

function SettingRow({ title, description, checked, onCheckedChange, icon: Icon }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200">
          <Icon className="h-4 w-4 shrink-0" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} className="mt-1" />
    </div>
  );
}

export function OperatorSettingsDialog({
  open,
  onOpenChange,
  preferences,
  onPreferencesChange,
}: OperatorSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-slate-950/95 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Impostazioni operatore</DialogTitle>
          <DialogDescription className="text-slate-300">
            Personalizza il comportamento della postazione. Le preferenze vengono salvate su questo browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <SettingRow
            title="Ologramma"
            description="Mostra l’avatar 3D dell’assistente. Se disattivato, l’audio continua a funzionare senza hologram."
            checked={preferences.hologramEnabled}
            onCheckedChange={(checked) => onPreferencesChange({ ...preferences, hologramEnabled: checked })}
            icon={Sparkles}
          />
          <SettingRow
            title="Wakeword"
            description="Abilita l’ascolto della frase di attivazione per avviare le richieste vocali quando la sessione operatore e attiva."
            checked={preferences.wakeWordEnabled}
            onCheckedChange={(checked) => onPreferencesChange({ ...preferences, wakeWordEnabled: checked })}
            icon={Mic}
          />
          <SettingRow
            title="Grafica legacy forzata"
            description="Forza il foglio di stile legacy anche sui browser moderni. Utile in caso di compatibilita grafica."
            checked={preferences.forceLegacyGraphics}
            onCheckedChange={(checked) => onPreferencesChange({ ...preferences, forceLegacyGraphics: checked })}
            icon={MonitorCog}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
