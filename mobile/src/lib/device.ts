import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

const DEVICE_KEY = 'statusping.device-id';
export const PUSH_CHANNEL = 'status-updates';

let cached: string | null = null;

/** A random id that stands in for an account. It never leaves this device's storage. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  cached = id;
  return id;
}

export async function resetDeviceId() {
  cached = null;
  await AsyncStorage.removeItem(DEVICE_KEY);
}

export const pushSupported = Platform.OS !== 'web' && Device.isDevice;

export function configureNotifications() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(PUSH_CHANNEL, {
      name: 'Status updates',
      importance: AndroidImportance.HIGH,
    }).catch(() => {});
  }
}

/**
 * Returns this device's Expo push token, or null when push is unavailable or
 * the person declined. Only shows the permission prompt when `ask` is true.
 */
export async function getPushToken(ask: boolean): Promise<string | null> {
  if (!pushSupported) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    return null;
  }
}
