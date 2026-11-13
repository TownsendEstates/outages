import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';

import { Button, Card, Dot, Field, H, Loading, Notice, P, Row, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { APP_NAME, DEMO } from '@/lib/config';
import { getDeviceId, getPushToken } from '@/lib/device';
import { useLoad } from '@/lib/hooks';
import { OVERALL_HEADLINE, overallStatus, slugify } from '@/lib/status';
import { font, space, useTheme } from '@/theme';

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const [code, setCode] = useState('');

  const { data: followed, error, loading, refreshing, refresh } = useLoad(
    useCallback(async () => {
    const deviceId = await getDeviceId();
    const list = await api.getFollowed(deviceId);
    if (list.length) {
      // Push tokens rotate; keep ours current without ever prompting here.
      getPushToken(false).then((token) => {
        if (token) api.registerDevice(deviceId, token, Platform.OS).catch(() => {});
      });
    }
      return list;
    }, []),
  );

  // Accepts a bare code ("northwind") or a pasted link (".../s/northwind").
  const slug = slugify(code.trim().split(/[/?#]/).filter(Boolean).pop() ?? '');
  const open = () => {
    if (!slug) return;
    setCode('');
    router.push({ pathname: '/s/[slug]', params: { slug } });
  };

  if (loading) return <Loading />;

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <View style={{ gap: space.xs, paddingTop: space.sm }}>
        <P bold style={{ fontSize: font.display, lineHeight: 34 }}>
          Know the moment something breaks.
        </P>
        <P muted>Follow the businesses you rely on and get a push alert when their service goes down or comes back.</P>
      </View>

      {DEMO && (
        <Notice>
          Demo mode — sample data, nothing is saved. Try the page code “northwind”, or open the business side and sign
          in with any email.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <View style={{ gap: space.sm }}>
        <H>Following</H>
        {followed?.length ? (
          <Card>
            {followed.map((org, n) => {
              const status = overallStatus(org.component_statuses);
              return (
                <Row
                  key={org.id}
                  first={n === 0}
                  label={`${org.name}, ${OVERALL_HEADLINE[status]}`}
                  onPress={() => router.push({ pathname: '/s/[slug]', params: { slug: org.slug } })}>
                  <Dot color={t.status[status]} size={12} />
                  <View style={{ flex: 1 }}>
                    <P bold>{org.name}</P>
                    <P small style={{ color: t.status[status] }}>
                      {OVERALL_HEADLINE[status]}
                      {org.open_incidents > 0
                        ? ` · ${org.open_incidents} open incident${org.open_incidents === 1 ? '' : 's'}`
                        : ''}
                    </P>
                  </View>
                </Row>
              );
            })}
          </Card>
        ) : (
          <Card style={{ padding: space.lg }}>
            <P muted>
              You are not following anyone yet. Enter a page code below — you will find it on the business’s website
              or invoice.
            </P>
          </Card>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Field
          label="Find a status page"
          placeholder="Page code or link"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={open}
        />
        <Button title="Open status page" onPress={open} disabled={!slug} />
      </View>

      <Card style={{ padding: space.lg, gap: space.md, marginTop: space.md }}>
        <View style={{ gap: space.xs }}>
          <P bold>Run a business?</P>
          <P muted>
            Publish your own status page with {APP_NAME} and alert every customer at once, instead of answering the
            same call a hundred times.
          </P>
        </View>
        <Button title="Manage my status page" variant="secondary" onPress={() => router.push('/manage')} />
      </Card>
    </Screen>
  );
}
