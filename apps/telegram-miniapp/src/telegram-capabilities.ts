export interface TelegramStorageBridge {
  getItem: (key: string, callback: (error: string | null, value?: string | null) => void) => void;
  setItem: (key: string, value: string, callback?: (error: string | null) => void) => void;
  removeItem?: (key: string, callback?: (error: string | null) => void) => void;
}

export interface TelegramWebAppBridge {
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  addToHomeScreen?: () => void;
  DeviceStorage?: TelegramStorageBridge;
  SecureStorage?: TelegramStorageBridge;
}

export interface TelegramCapabilitySnapshot {
  fullscreen: boolean;
  homeScreen: boolean;
  deviceStorage: boolean;
  secureStorage: boolean;
}

export function detectTelegramCapabilities(
  tg: TelegramWebAppBridge | undefined,
): TelegramCapabilitySnapshot {
  return {
    fullscreen: typeof tg?.requestFullscreen === 'function' && typeof tg.exitFullscreen === 'function',
    homeScreen: typeof tg?.addToHomeScreen === 'function',
    deviceStorage: !!tg?.DeviceStorage,
    secureStorage: !!tg?.SecureStorage,
  };
}

export function requestCommandCenterFullscreen(tg: TelegramWebAppBridge | undefined): boolean {
  if (typeof tg?.requestFullscreen !== 'function') return false;
  tg.requestFullscreen();
  return true;
}

export function requestHomeScreenShortcut(tg: TelegramWebAppBridge | undefined): boolean {
  if (typeof tg?.addToHomeScreen !== 'function') return false;
  tg.addToHomeScreen();
  return true;
}

export async function setDeviceStorageItem(
  tg: TelegramWebAppBridge | undefined,
  key: string,
  value: string,
): Promise<boolean> {
  return setStorageItem(tg?.DeviceStorage, key, value);
}

export async function getDeviceStorageItem(
  tg: TelegramWebAppBridge | undefined,
  key: string,
): Promise<string | null> {
  return getStorageItem(tg?.DeviceStorage, key);
}

export async function setSecureStorageItem(
  tg: TelegramWebAppBridge | undefined,
  key: string,
  value: string,
): Promise<boolean> {
  return setStorageItem(tg?.SecureStorage, key, value);
}

async function setStorageItem(
  storage: TelegramStorageBridge | undefined,
  key: string,
  value: string,
): Promise<boolean> {
  if (!storage) return false;
  return new Promise((resolve) => {
    storage.setItem(key, value, (error) => resolve(!error));
  });
}

async function getStorageItem(
  storage: TelegramStorageBridge | undefined,
  key: string,
): Promise<string | null> {
  if (!storage) return null;
  return new Promise((resolve) => {
    storage.getItem(key, (error, value) => resolve(error ? null : value ?? null));
  });
}
