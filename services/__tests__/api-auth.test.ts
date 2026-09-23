import AsyncStorage from '@react-native-async-storage/async-storage';
import { API } from '../api';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const response = (body: unknown, status = 200, cookie?: string) => ({
  ok: status >= 200 && status < 300, status,
  headers: new Headers(cookie ? { 'Set-Cookie': cookie } : {}),
  json: async () => body,
} as Response);

beforeEach(async () => {
  await AsyncStorage.clear();
  global.fetch = jest.fn();
});

test('login cookies reach protected requests without Set-Cookie attributes', async () => {
  const api = new API('https://example.com');
  (fetch as jest.Mock).mockResolvedValueOnce(response({ ok: true }, 200,
    'auth=abc==; Path=/; HttpOnly; Expires=Wed, 21 Oct 2030 07:28:00 GMT, session=xyz; Secure; SameSite=Lax'))
    .mockImplementationOnce(async (_url, options) => {
      expect(new Headers(options.headers).get('Cookie')).toBe('auth=abc==; session=xyz');
      expect(options.credentials).toBe('include');
      return response([{ key: 'source' }]);
    });
  await api.login(undefined, 'password');
  await expect(api.getResources()).resolves.toEqual([{ key: 'source' }]);
});

test('legacy stored Set-Cookie is normalized and POST headers/body are preserved', async () => {
  await AsyncStorage.setItem('authCookies', 'auth=old; Path=/; HttpOnly');
  (fetch as jest.Mock).mockImplementation(async (_url, options) => {
    const headers = new Headers(options.headers);
    expect(headers.get('Cookie')).toBe('auth=old');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ keyword: 'movie' });
    return response(['movie']);
  });
  await expect(new API('https://example.com').addSearchHistory('movie')).resolves.toEqual(['movie']);
});

test('an unsuccessful login body cannot replace the saved session', async () => {
  (fetch as jest.Mock).mockResolvedValue(response({ ok: false }, 200, 'auth=bad; Path=/'));
  await expect(new API('https://example.com').login(undefined, 'wrong')).rejects.toThrow();
  expect(await AsyncStorage.getItem('authCookies')).toBeNull();
});

test('logout clears the saved session even when the server rejects it', async () => {
  await AsyncStorage.setItem('authCookies', 'auth=expired');
  (fetch as jest.Mock).mockResolvedValue(response({}, 401));
  await expect(new API('https://example.com').logout()).rejects.toThrow('UNAUTHORIZED');
  expect(await AsyncStorage.getItem('authCookies')).toBeFalsy();
});

test('cookies saved on login are not sent to another server', async () => {
  const api = new API('https://first.example');
  (fetch as jest.Mock).mockResolvedValueOnce(response({ ok: true }, 200, 'auth=secret; Path=/'));
  await api.login('user', 'password');
  api.setBaseUrl('https://second.example');
  (fetch as jest.Mock).mockImplementationOnce(async (_url, options) => {
    expect(new Headers(options.headers).get('Cookie')).toBeNull();
    return response({ SiteName: 'second', StorageType: 'redis' });
  });
  await api.getServerConfig();
});

test('requests without saved cookies retain native cookie handling and cancellation', async () => {
  const controller = new AbortController();
  (fetch as jest.Mock).mockImplementation(async (_url, options) => {
    expect(new Headers(options.headers).get('Cookie')).toBeNull();
    expect(options.credentials).toBe('include');
    expect(options.signal).toBe(controller.signal);
    return response([]);
  });
  await new API('https://example.com').getResources(controller.signal);
});

