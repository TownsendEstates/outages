import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { APP_NAME } from '@/lib/config';
import { configureNotifications } from '@/lib/device';
import { SessionProvider } from '@/lib/hooks';
import { useTheme } from '@/theme';

/** Tapping a push notification opens the status page it is about. */
function NotificationRouter() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const slug = response?.notification.request.content.data?.slug;
    if (typeof slug === 'string' && slug) {
      router.push({ pathname: '/s/[slug]', params: { slug } });
      Notifications.clearLastNotificationResponse();
    }
  }, [response, router]);
  return null;
}

export default function RootLayout() {
  const t = useTheme();
  useEffect(configureNotifications, []);
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      {Platform.OS !== 'web' && <NotificationRouter />}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: t.bg },
        }}>
        <Stack.Screen name="index" options={{ title: APP_NAME }} />
        <Stack.Screen name="s/[slug]" options={{ title: 'Status' }} />
        <Stack.Screen name="manage" options={{ headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}
