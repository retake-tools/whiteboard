export interface RetakeUiPreferences {
  isBoardMenuOpen: boolean;
  isBoardMenuPinned: boolean;
  isMiniMapVisible: boolean;
  isProjectMenuOpen: boolean;
  isProjectMenuPinned: boolean;
  showGrid: boolean;
}

const uiPreferencesKey = 'retake.whiteboard.uiPreferences';

const defaultUiPreferences: RetakeUiPreferences = {
  isBoardMenuOpen: false,
  isBoardMenuPinned: false,
  isMiniMapVisible: true,
  isProjectMenuOpen: false,
  isProjectMenuPinned: false,
  showGrid: true,
};

export function loadUiPreferences(): RetakeUiPreferences {
  try {
    const raw = localStorage.getItem(uiPreferencesKey);
    if (!raw) return defaultUiPreferences;
    return { ...defaultUiPreferences, ...(JSON.parse(raw) as Partial<RetakeUiPreferences>) };
  } catch {
    return defaultUiPreferences;
  }
}

export function saveUiPreferences(preferences: Partial<RetakeUiPreferences>): void {
  try {
    localStorage.setItem(uiPreferencesKey, JSON.stringify({ ...loadUiPreferences(), ...preferences }));
  } catch {
    // Static previews and restricted browsers can run without UI persistence.
  }
}
