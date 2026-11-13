import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Field, H, Notice, P, Screen, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useReadyDashboard, useSession } from '@/lib/hooks';
import { PLAN_LIMITS } from '@/lib/plans';
import { space, useTheme } from '@/theme';

const SWATCHES = ['#2563EB', '#0F766E', '#15803D', '#B45309', '#C2410C', '#BE123C', '#7C3AED', '#1F2937'];

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { org, reload } = useReadyDashboard();
  const [name, setName] = useState(org.name);
  const [email, setEmail] = useState(org.support_email ?? '');
  const [phone, setPhone] = useState(org.support_phone ?? '');
  const [url, setUrl] = useState(org.support_url ?? '');
  const [color, setColor] = useState(org.brand_color);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const canBrand = PLAN_LIMITS[org.plan].customBranding;
  const link = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();

  const save = () =>
    run(async () => {
      setSaved(false);
      await api.updateOrg(org.id, {
        name: name.trim(),
        support_email: email.trim() || null,
        support_phone: phone.trim() || null,
        support_url: link || null,
        brand_color: color,
      });
      await reload();
      setSaved(true);
    });

  const deleteAccount = async () => {
    const ok = await confirm(
      'Delete your account?',
      'Your status page, services, incident history and subscriber list are permanently deleted. This cannot be undone. An active subscription is not cancelled automatically — cancel it in the App Store or Google Play.',
      'Delete everything',
    );
    if (ok) run(() => api.deleteAccount());
  };

  return (
    <Screen>
      {error && <Notice tone="error">{error}</Notice>}
      {saved && <Notice>Saved.</Notice>}

      <Field label="Business name" value={name} onChangeText={setName} maxLength={60} />

      <View style={{ gap: space.md }}>
        <H>How customers reach you</H>
        <Field
          label="Support email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Field label="Support phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={40} />
        <Field
          label="Support website"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
      </View>

      <View style={{ gap: space.md }}>
        <H>Brand colour</H>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, opacity: canBrand ? 1 : 0.45 }}>
          {SWATCHES.map((c) => (
            <Pressable
              key={c}
              disabled={!canBrand}
              onPress={() => setColor(c)}
              accessibilityRole="radio"
              accessibilityLabel={`Colour ${c}`}
              accessibilityState={{ checked: color.toUpperCase() === c, disabled: !canBrand }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 44,
                backgroundColor: c,
                borderWidth: 3,
                borderColor: color.toUpperCase() === c ? t.text : 'transparent',
              }}
            />
          ))}
        </View>
        {!canBrand && (
          <View style={{ gap: space.sm }}>
            <P small muted>
              Your own colour on the status page is part of Pro and Business.
            </P>
            <Button title="See plans" variant="secondary" onPress={() => router.push('/manage/plans')} />
          </View>
        )}
      </View>

      <Button title="Save changes" onPress={save} busy={busy} disabled={name.trim().length < 2} />

      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <H>Account</H>
        <P small muted>
          Signed in as {user?.email}
        </P>
        <Button title="Sign out" variant="secondary" onPress={() => api.signOut()} />
        <Button title="Delete account" variant="danger" onPress={deleteAccount} disabled={busy} />
      </View>
    </Screen>
  );
}
