import React from 'react';
import renderer, { act } from 'react-test-renderer';
import LoginModal from '../LoginModal';

const mockLogin = jest.fn();
let mockConfig: { StorageType: string } | null = null;
jest.mock('@/stores/authStore', () => ({ __esModule: true, default: () => ({
  isLoginModalVisible: false, hideLoginModal: jest.fn(), login: mockLogin,
}) }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ serverConfig: mockConfig }) }));
jest.mock('@/stores/homeStore', () => ({ __esModule: true, default: () => ({ refreshPlayRecords: jest.fn() }) }));
jest.mock('@/services/storage', () => ({ LoginCredentialsManager: { save: jest.fn(), get: jest.fn() } }));
jest.mock('expo-router', () => ({ usePathname: () => '/' }));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('../ThemedView', () => ({ ThemedView: 'View' }));
jest.mock('../ThemedText', () => ({ ThemedText: 'Text' }));
jest.mock('../StyledButton', () => ({ StyledButton: 'Button' }));
jest.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles },
  Keyboard: { dismiss: jest.fn() }, Alert: { alert: jest.fn() },
  InteractionManager: { runAfterInteractions: jest.fn() },
}));

beforeEach(() => { mockLogin.mockReset(); mockConfig = null; });

test.each([null, { StorageType: 'localstorage' }, { StorageType: 'd1' }])(
  'password-only submission is allowed for unknown/local config, not known account mode: %j', async (config) => {
    mockConfig = config;
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<LoginModal />); });
    const password = tree.root.findAllByType('TextInput' as any).find(input => input.props.secureTextEntry);
    act(() => { password!.props.onChangeText('password'); });
    await act(async () => { await tree.root.findByType('Button' as any).props.onPress(); });
    if (config?.StorageType === 'd1') {
      expect(mockLogin).not.toHaveBeenCalled();
    } else {
      expect(mockLogin).toHaveBeenCalledWith(undefined, 'password');
    }
    act(() => tree.unmount());
  },
);

