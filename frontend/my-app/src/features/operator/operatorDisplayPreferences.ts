export const OPERATOR_DISPLAY_PREFERENCES_KEY = 'holo-assistant.operator-display-preferences';

export type OperatorDisplayPreferences = {
  hologramEnabled: boolean;
  wakeWordEnabled: boolean;
  forceLegacyGraphics: boolean;
};

export const DEFAULT_OPERATOR_DISPLAY_PREFERENCES: OperatorDisplayPreferences = {
  hologramEnabled: true,
  wakeWordEnabled: true,
  forceLegacyGraphics: false,
};

function isBrowser() {
  return typeof window !== 'undefined';
}

export function readOperatorDisplayPreferences(): OperatorDisplayPreferences {
  if (!isBrowser()) {
    return DEFAULT_OPERATOR_DISPLAY_PREFERENCES;
  }

  try {
    const storedValue = window.localStorage.getItem(OPERATOR_DISPLAY_PREFERENCES_KEY);
    if (!storedValue) {
      return DEFAULT_OPERATOR_DISPLAY_PREFERENCES;
    }

    const parsedValue = JSON.parse(storedValue) as Partial<OperatorDisplayPreferences>;
    return {
      hologramEnabled: parsedValue.hologramEnabled ?? DEFAULT_OPERATOR_DISPLAY_PREFERENCES.hologramEnabled,
      wakeWordEnabled: parsedValue.wakeWordEnabled ?? DEFAULT_OPERATOR_DISPLAY_PREFERENCES.wakeWordEnabled,
      forceLegacyGraphics: parsedValue.forceLegacyGraphics ?? DEFAULT_OPERATOR_DISPLAY_PREFERENCES.forceLegacyGraphics,
    };
  } catch (error) {
    console.warn('Impossibile leggere le preferenze grafiche operatore:', error);
    return DEFAULT_OPERATOR_DISPLAY_PREFERENCES;
  }
}

export function writeOperatorDisplayPreferences(preferences: OperatorDisplayPreferences): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(OPERATOR_DISPLAY_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function applyLegacyGraphicsPreference(forceLegacyGraphics: boolean): void {
  if (!isBrowser()) {
    return;
  }

  const legacyCss = document.getElementById('legacy-css') as HTMLLinkElement | null;
  if (legacyCss) {
    legacyCss.disabled = !forceLegacyGraphics;
  }

  document.documentElement.dataset.operatorLegacyGraphics = forceLegacyGraphics ? 'forced' : 'auto';
}
