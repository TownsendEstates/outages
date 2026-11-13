import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';

import { IncidentCard } from '@/components/incident-card';
import { Button, Card, Centered, Dot, H, Loading, Notice, P, Row, Screen, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/config';
import { getDeviceId, getPushToken, pushSupported } from '@/lib/device';
import { useAction, useLoad } from '@/lib/hooks';
import { OVERALL_HEADLINE, dateTime, overallStatus } from '@/lib/status';
import { font, readableOn, space, tint, useTheme } from '@/theme';

export default function StatusPageScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const t = useTheme();
  const router = useRouter();
  const [openPast, setOpenPast] = useState<string | null>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const follow = useAction();

  const { data, error, loading, refreshing, refresh, reload } = useLoad(
    useCallback(async () => {
    const deviceId = await getDeviceId();
    const [page, followed] = await Promise.all([api.getStatusPage(slug), api.getFollowed(deviceId)]);
      return { page, following: !!page && followed.some((f) => f.id === page.org.id) };
    }, [slug]),
  );

  if (loading) return <Loading />;

  if (!data?.page) {
    return (
      <Centered>
        <P bold style={{ fontSize: font.title }}>
          {error ? 'Could not load this page' : 'No status page here'}
        </P>
        <P muted style={{ textAlign: 'center' }}>
          {error ?? `Nothing is published under the code “${slug}”. Check the spelling and try again.`}
        </P>
        <Button title={error ? 'Try again' : 'Back'} variant="secondary" onPress={error ? reload : () => router.back()} />
      </Centered>
    );
  }

  const { page, following } = data;
  const { org, components } = page;
  const overall = overallStatus(components.map((c) => c.status));
  const active = page.incidents.filter((i) => i.status !== 'resolved');
  const past = page.incidents.filter((i) => i.status === 'resolved');
  const onBrand = readableOn(org.brand_color);
  const lastUpdate = page.incidents.flatMap((i) => i.updates.map((u) => u.created_at)).sort().pop();

  const toggleFollow = () =>
    follow.run(async () => {
      const deviceId = await getDeviceId();
      if (following) {
        await api.unfollow(deviceId, org.id);
        setPushNote(null);
      } else {
        const token = await getPushToken(true);
        await api.follow(deviceId, org.slug, token, Platform.OS);
        setPushNote(
          token
            ? null
            : pushSupported
              ? 'Saved to your list. Notifications are switched off for this app — turn them on in your phone’s settings to get alerts.'
              : 'Saved to your list. Push alerts arrive in the iOS and Android app.',
        );
      }
      await reload();
    });

  const contacts = [
    org.support_phone && { label: org.support_phone, url: `tel:${org.support_phone.replace(/[^\d+]/g, '')}` },
    org.support_email && { label: org.support_email, url: `mailto:${org.support_email}` },
    org.support_url && { label: org.support_url.replace(/^https?:\/\//, ''), url: org.support_url },
  ].filter((c): c is { label: string; url: string } => !!c);

  return (
    <Screen
      onRefresh={refresh}
      refreshing={refreshing}
      top={
        <View style={{ backgroundColor: org.brand_color }}>
          <View
            style={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: space.lg, paddingVertical: space.xl }}>
            <View
              style={{
                backgroundColor: t.surface,
                borderRadius: 16,
                padding: space.lg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
              }}>
              <Dot color={t.status[overall]} size={16} />
              <View style={{ flex: 1, gap: 2 }}>
                <P bold style={{ fontSize: 22, lineHeight: 28, color: t.status[overall] }}>
                  {OVERALL_HEADLINE[overall]}
                </P>
                <P small muted>
                  {lastUpdate ? `Last update ${dateTime(lastUpdate)}` : 'No incidents reported'}
                </P>
              </View>
            </View>
          </View>
        </View>
      }>
      <Stack.Screen options={{ title: org.name }} />

      <View style={{ gap: space.sm }}>
        <Button
          title={following ? 'Following — tap to stop alerts' : 'Follow and get alerts'}
          variant={following ? 'secondary' : 'primary'}
          color={org.brand_color}
          onColor={onBrand}
          busy={follow.busy}
          onPress={toggleFollow}
        />
        {follow.error && <Notice tone="error">{follow.error}</Notice>}
        {pushNote && <Notice>{pushNote}</Notice>}
      </View>

      {active.length > 0 && (
        <View style={{ gap: space.sm }}>
          <H>Happening now</H>
          {active.map((i) => (
            <IncidentCard key={i.id} incident={i} components={components} />
          ))}
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <H>Services</H>
        <Card>
          {components.length === 0 && (
            <Row first>
              <P muted>No services listed yet.</P>
            </Row>
          )}
          {components.map((c, n) => (
            <Row key={c.id} first={n === 0}>
              <P style={{ flex: 1 }}>{c.name}</P>
              <StatusPill status={c.status} />
            </Row>
          ))}
        </Card>
      </View>

      {past.length > 0 && (
        <View style={{ gap: space.sm }}>
          <H>Past incidents</H>
          {past.map((i) =>
            openPast === i.id ? (
              <Pressable key={i.id} onPress={() => setOpenPast(null)} accessibilityLabel={`Collapse ${i.title}`}>
                <IncidentCard incident={i} components={components} />
              </Pressable>
            ) : (
              <Card key={i.id}>
                <Row first onPress={() => setOpenPast(i.id)} label={`${i.title}, resolved. Show details`}>
                  <View style={{ flex: 1 }}>
                    <P bold>{i.title}</P>
                    <P small muted>
                      Resolved {dateTime(i.resolved_at ?? i.started_at)}
                    </P>
                  </View>
                </Row>
              </Card>
            ),
          )}
        </View>
      )}

      {contacts.length > 0 && (
        <View style={{ gap: space.sm }}>
          <H>Contact {org.name}</H>
          <Card>
            {contacts.map((c, n) => (
              <Row key={c.url} first={n === 0} onPress={() => Linking.openURL(c.url)} label={c.label}>
                <P style={{ flex: 1, color: t.accent }}>{c.label}</P>
              </Row>
            ))}
          </Card>
        </View>
      )}

      {org.show_badge && (
        <View
          style={{
            alignSelf: 'center',
            backgroundColor: tint(t.muted, 0.12),
            borderRadius: 999,
            paddingHorizontal: space.md,
            paddingVertical: 6,
          }}>
          <P small muted>
            Powered by {APP_NAME}
          </P>
        </View>
      )}
    </Screen>
  );
}
