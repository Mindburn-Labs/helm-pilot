import { describe, it, expect, vi } from 'vitest';
import {
  detectTelegramCapabilities,
  getDeviceStorageItem,
  requestCommandCenterFullscreen,
  requestHomeScreenShortcut,
  setDeviceStorageItem,
  setSecureStorageItem,
  type TelegramWebAppBridge,
} from '../telegram-capabilities.js';

describe('telegram capabilities', () => {
  it('detects Bot API 8.0 mini app capabilities', () => {
    const tg: TelegramWebAppBridge = {
      requestFullscreen: vi.fn(),
      exitFullscreen: vi.fn(),
      addToHomeScreen: vi.fn(),
      DeviceStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
      },
      SecureStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
      },
    };

    expect(detectTelegramCapabilities(tg)).toEqual({
      fullscreen: true,
      homeScreen: true,
      deviceStorage: true,
      secureStorage: true,
    });
  });

  it('requests fullscreen and home-screen shortcuts when available', () => {
    const tg: TelegramWebAppBridge = {
      requestFullscreen: vi.fn(),
      addToHomeScreen: vi.fn(),
    };

    expect(requestCommandCenterFullscreen(tg)).toBe(true);
    expect(requestHomeScreenShortcut(tg)).toBe(true);
    expect(tg.requestFullscreen).toHaveBeenCalledOnce();
    expect(tg.addToHomeScreen).toHaveBeenCalledOnce();
  });

  it('uses device and secure storage without falling back to globals', async () => {
    const tg: TelegramWebAppBridge = {
      DeviceStorage: {
        getItem: vi.fn((_key, cb) => cb(null, 'build')),
        setItem: vi.fn((_key, _value, cb) => cb?.(null)),
      },
      SecureStorage: {
        getItem: vi.fn(),
        setItem: vi.fn((_key, _value, cb) => cb?.(null)),
      },
    };

    await expect(setDeviceStorageItem(tg, 'pilot_active_tab', 'build')).resolves.toBe(true);
    await expect(getDeviceStorageItem(tg, 'pilot_active_tab')).resolves.toBe('build');
    await expect(setSecureStorageItem(tg, 'pilot_session_hint', '{}')).resolves.toBe(true);
  });
});
