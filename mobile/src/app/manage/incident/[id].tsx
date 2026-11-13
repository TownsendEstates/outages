import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { IncidentCard } from '@/components/incident-card';
import { Button, Centered, Choices, Field, H, Notice, P, Screen, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useReadyDashboard } from '@/lib/hooks';
import { INCIDENT_LABEL, INCIDENT_STATUSES } from '@/lib/status';
import type { IncidentStatus } from '@/lib/types';
import { space, useTheme } from '@/theme';

export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const router = useRouter();
  const { components, incidents, reload } = useReadyDashboard();
  const incident = incidents.find((i) => i.id === id);
  const [status, setStatus] = useState<IncidentStatus>(
    incident && incident.status !== 'resolved' ? nextStatus(incident.status) : 'monitoring',
  );
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();

  if (!incident) {
    return (
      <Centered>
        <P muted>This incident no longer exists.</P>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </Centered>
    );
  }

  const resolved = incident.status === 'resolved';

  const post = () =>
    run(async () => {
      await api.postUpdate(incident.id, status, body.trim());
      setBody('');
      await reload();
      if (status === 'resolved') router.back();
    });

  const remove = async () => {
    const ok = await confirm(
      'Delete this incident?',
      'It will be removed from your status page and its history. Subscribers are not notified.',
      'Delete',
    );
    if (ok) run(async () => (await api.deleteIncident(incident.id), await reload(), router.back()));
  };

  return (
    <Screen>
      <IncidentCard incident={incident} components={components} />
      {error && <Notice tone="error">{error}</Notice>}

      <View style={{ gap: space.lg }}>
        <H>{resolved ? 'Reopen with an update' : 'Post an update'}</H>
        <Choices
          label="Where things stand"
          value={status}
          onChange={setStatus}
          options={INCIDENT_STATUSES.map((s) => ({ value: s, label: INCIDENT_LABEL[s] }))}
          colorFor={(s) => (s === 'resolved' ? t.status.operational : t.accent)}
        />
        <Field
          label="Message to customers"
          placeholder={status === 'resolved' ? 'What was fixed.' : 'What has changed since the last update.'}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={2000}
        />
        {status === 'resolved' && !resolved && (
          <Notice>Resolving sets the affected services back to Operational.</Notice>
        )}
        <Button
          title={status === 'resolved' ? 'Resolve and alert subscribers' : 'Post update and alert subscribers'}
          onPress={post}
          busy={busy}
          disabled={!body.trim()}
        />
        <Button title="Delete incident" variant="danger" onPress={remove} disabled={busy} />
      </View>
    </Screen>
  );
}

function nextStatus(s: IncidentStatus): IncidentStatus {
  return INCIDENT_STATUSES[Math.min(INCIDENT_STATUSES.indexOf(s) + 1, INCIDENT_STATUSES.length - 1)];
}
