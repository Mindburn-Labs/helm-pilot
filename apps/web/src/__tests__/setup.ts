import { vi } from 'vitest';

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

// Mock window.location
const locationMock = { href: '/', assign: vi.fn(), replace: vi.fn(), reload: vi.fn() };
Object.defineProperty(globalThis, 'location', { value: locationMock, writable: true });

// Mock global fetch
globalThis.fetch = vi.fn(
  async () => new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
);

// Reset between tests
beforeEach(() => {
  vi.clearAllMocks();
  mockLocalStorage.clear();
  document.cookie.split(';').forEach((cookie) => {
    document.cookie = cookie
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/');
  });
  locationMock.href = '/';
});
