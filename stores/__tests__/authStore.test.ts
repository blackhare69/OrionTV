import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import useAuthStore from '../authStore';
import { useSettingsStore } from '../settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/services/storage', () => ({ SettingsManager: { get: jest.fn() } }));
jest.mock('@/utils/Logger', () => ({ __esModule: true, default: { withTag: () => ({ error: jest.fn() }) } }));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  api.setBaseUrl('https://example.com');
  useSettingsStore.setState({ serverConfig: null, isLoadingServerConfig: false });
  useAuthStore.setState({ isLoggedIn: false, isLoginModalVisible: false });
  global.fetch = jest.fn();
});

test.each([401, 500])('config HTTP %s leaves login reachable, even with a stale cookie', async (status) => {
  await AsyncStorage.setItem('authCookies', 'auth=expired');
  (fetch as jest.Mock).mockResolvedValue({ ok: false, status });
  await useSettingsStore.getState().fetchServerConfig();
  await useAuthStore.getState().checkLoginStatus('https://example.com');
  expect(useAuthStore.getState().isLoggedIn).toBe(false);
  expect(useAuthStore.getState().isLoginModalVisible).toBe(true);
});

test('no configured server does not prompt for login', async () => {
  await useAuthStore.getState().checkLoginStatus('');
  expect(useAuthStore.getState().isLoginModalVisible).toBe(false);
});

test('password-only login retries protected config before marking the session ready', async () => {
  useAuthStore.setState({ isLoginModalVisible: true });
  (fetch as jest.Mock).mockImplementation(async (url, options) => {
    if (url.endsWith('/api/login')) {
      expect(JSON.parse(options.body)).toEqual({ password: 'password' });
      return { ok: true, status: 200, headers: new Headers({ 'Set-Cookie': 'auth=valid; Path=/; HttpOnly' }), json: async () => ({ ok: true }) };
    }
    expect(new Headers(options.headers).get('Cookie')).toBe('auth=valid');
    return { ok: true, status: 200, json: async () => ({ SiteName: 'MoonTV', StorageType: 'localstorage' }) };
  });
  await useAuthStore.getState().login(undefined, 'password');
  expect(useSettingsStore.getState().serverConfig?.StorageType).toBe('localstorage');
  expect(useAuthStore.getState().isLoggedIn).toBe(true);
  expect(useAuthStore.getState().isLoginModalVisible).toBe(false);
});

test('a genuine config failure after login is not reported as a working session', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) })
    .mockResolvedValueOnce({ ok: false, status: 500 });
  await expect(useAuthStore.getState().login('user', 'password')).rejects.toThrow();
  expect(useAuthStore.getState().isLoggedIn).toBe(false);
});

