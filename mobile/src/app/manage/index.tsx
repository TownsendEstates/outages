import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Setup } from '@/components/setup';
import { SignIn } from '@/components/sign-in';
import { Button, Card, Centered, Dot, H, Loading, Notice, P, Pill, Row, Screen, StatusPill } from '@/components/ui';
import { WEB_URL } from '@/lib/config';
import { useDashboard, useSession } from '@/lib/hooks';
import { PLAN_LIMITS, formatLimit, planName } from '@/lib/plans';
import { IMPACT_TO_COMPONENT, INCIDENT_LABEL, OVERALL_HEADLINE, overallStatus, timeAgo } from '@/lib/status';
import type { Dashboard } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function ManageIndex() {
  const { user } = useSession();
  const { dash, error, reload } = useDashboard();

  if (user === null) return <SignIn />;
  if (error && dash === undefined) {
    return (
      <Centered>
        <P muted style={{ textAlign: 'center' }}>
          {error}
        </P>
        <Button title="Try again" variant="secondary" onPress={reload} />
      </Centered>
    );
  }
  if (user === undefined || dash === undefined) return <Loading />;
  if (dash === null) return <Setup />;
  return <DashboardScreen dash={dash} reload={reload} />;
}

function DashboardScreen({ dash, reload }: { dash: Dashboard; reload: () => Promise<void> }) {
  const t = useTheme();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { org, components, incidents, followerCount } = dash;

  const limits = PLAN_LIMITS[org.plan];
  const overall = overallStatus(components.map((c) => c.status));
  const open = incidents.filter((i) => i.status !== 'resolved');
  const recent = incidents.filter((i) => i.status === 'resolved').slice(0, 5);
  const overFollowers = followerCount > limits.maxFollowers;
  const atServiceLimit = components.length >= limits.maxComponents;
  const link = WEB_URL ? `${WEB_URL}/s/${org.slug}` : org.slug;

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: org.name }} />

      <Card style={{ padding: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Dot color={t.status[overall]} size={16} />
          <View style={{ flex: 1, gap: 2 }}>
            <P bold style={{ fontSize: 22, lineHeight: 28, color: t.status[overall] }}>
              {OVERALL_HEADLINE[overall]}
            </P>
            <P small muted>
              This is what your customers see right now.
            </P>
          </View>
        </View>
        <Button title="Report an incident" onPress={() => router.push('/manage/incident/new')} />
      </Card>

      {open.length > 0 && (
        <View style={{ gap: space.sm }}>
          <H>Open incidents</H>
          <Card>
            {open.map((i, n) => (
              <Row
                key={i.id}
                first={n === 0}
                label={`${i.title}, ${INCIDENT_LABEL[i.status]}`}
                onPress={() => router.push({ pathname: '/manage/incident/[id]', params: { id: i.id } })}>
                <Dot color={t.status[IMPACT_TO_COMPONENT[i.impact]]} size={12} />
                <View style={{ flex: 1 }}>
                  <P bold>{i.title}</P>
                  <P small muted>
                    {INCIDENT_LABEL[i.status]} · last update {timeAgo(i.updates[0]?.created_at ?? i.started_at)}
                  </P>
                </View>
              </Row>
            ))}
          </Card>
        </View>
      )}

      <View style={{ gap: space.sm }}>
        <H>
          Services · {components.length} of {formatLimit(limits.maxComponents)}
        </H>
        <Card>
          {components.map((c, n) => (
            <Row
              key={c.id}
              first={n === 0}
              label={`Edit ${c.name}`}
              onPress={() => router.push({ pathname: '/manage/service', params: { id: c.id } })}>
              <P style={{ flex: 1 }}>{c.name}</P>
              <StatusPill status={c.status} />
            </Row>
          ))}
          <Row
            first={components.length === 0}
            label={atServiceLimit ? 'Upgrade to add more services' : 'Add a service'}
            onPress={() => router.push(atServiceLimit ? '/manage/plans' : '/manage/service')}>
            <P style={{ flex: 1, color: t.accent }} bold>
              {atServiceLimit ? 'Upgrade to add more services' : '+ Add a service'}
            </P>
          </Row>
        </Card>
      </View>

      <View style={{ gap: space.sm }}>
        <H>Your page</H>
        <Card>
          <Row first>
            <View style={{ flex: 1 }}>
              <P small muted>
                {WEB_URL ? 'Link to share with customers' : 'Page code to share with customers'}
              </P>
              <P bold>
                {link.replace(/^https?:\/\//, '')}
              </P>
            </View>
            <Button title={copied ? 'Copied' : 'Copy'} variant="link" onPress={copy} />
          </Row>
          <Row label="View public page" onPress={() => router.push({ pathname: '/s/[slug]', params: { slug: org.slug } })}>
            <P style={{ flex: 1 }}>View public page</P>
          </Row>
          <Row label="Subscribers and plan" onPress={() => router.push('/manage/plans')}>
            <View style={{ flex: 1 }}>
              <P>
                {followerCount.toLocaleString()} subscriber{followerCount === 1 ? '' : 's'}
              </P>
              <P small muted>
                {planName(org.plan)} plan · alerts reach up to {formatLimit(limits.maxFollowers).toLowerCase()}
              </P>
            </View>
            <Pill label={planName(org.plan)} color={t.accent} />
          </Row>
          <Row label="Settings" onPress={() => router.push('/manage/settings')}>
            <P style={{ flex: 1 }}>Settings</P>
          </Row>
        </Card>
        {overFollowers && (
          <Notice>
            {(followerCount - limits.maxFollowers).toLocaleString()} of your subscribers are not receiving alerts
            because the {planName(org.plan)} plan notifies {formatLimit(limits.maxFollowers)}. Upgrade to reach everyone.
          </Notice>
        )}
      </View>

      {recent.length > 0 && (
        <View style={{ gap: space.sm }}>
          <H>Recently resolved</H>
          <Card>
            {recent.map((i, n) => (
              <Row
                key={i.id}
                first={n === 0}
                label={i.title}
                onPress={() => router.push({ pathname: '/manage/incident/[id]', params: { id: i.id } })}>
                <View style={{ flex: 1 }}>
                  <P>{i.title}</P>
                  <P small muted>
                    Resolved {timeAgo(i.resolved_at ?? i.started_at)}
                  </P>
                </View>
              </Row>
            ))}
          </Card>
        </View>
      )}
    </Screen>
  );
}
