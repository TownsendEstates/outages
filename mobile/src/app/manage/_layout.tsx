import { Stack } from 'expo-router';

import { DashboardProvider, useDashboard, useSession } from '@/lib/hooks';
import { useTheme } from '@/theme';

function ManageStack() {
  const t = useTheme();
  const { dash } = useDashboard();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.bg },
      }}>
      {/* index shows sign-in, page setup or the dashboard, whichever applies */}
      <Stack.Screen name="index" options={{ title: '' }} />
      {/* everything else needs a signed-in owner with a page */}
      <Stack.Protected guard={!!dash}>
        <Stack.Screen name="service" options={{ title: 'Service' }} />
        <Stack.Screen name="incident/new" options={{ title: 'Report an incident' }} />
        <Stack.Screen name="incident/[id]" options={{ title: 'Incident' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="plans" options={{ title: 'Plans' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function ManageLayout() {
  const { user } = useSession();
  const userId = user === undefined ? undefined : (user?.id ?? null);
  return (
    <DashboardProvider key={userId ?? (userId === null ? 'signed-out' : 'loading')} userId={userId}>
      <ManageStack />
    </DashboardProvider>
  );
}
