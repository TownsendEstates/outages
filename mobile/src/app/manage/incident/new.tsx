import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, Choices, Field, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useReadyDashboard } from '@/lib/hooks';
import { PLAN_LIMITS } from '@/lib/plans';
import { COMPONENT_LABEL, IMPACTS, IMPACT_LABEL, IMPACT_TO_COMPONENT } from '@/lib/status';
import type { Impact } from '@/lib/types';
import { useTheme } from '@/theme';

export default function NewIncident() {
  const t = useTheme();
  const router = useRouter();
  const { org, components, followerCount, reload } = useReadyDashboard();
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<Impact>('major');
  const [affected, setAffected] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const { busy, error, run } = useAction();

  const reach = Math.min(followerCount, PLAN_LIMITS[org.plan].maxFollowers);
  const ready = title.trim().length >= 3 && body.trim().length > 0;
  const toggle = (id: string) => setAffected((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  const publish = () =>
    run(async () => {
      await api.reportIncident({
        orgId: org.id,
        title: title.trim(),
        impact,
        componentIds: affected,
        componentStatus: affected.length ? IMPACT_TO_COMPONENT[impact] : null,
        body: body.trim(),
      });
      await reload();
      router.back();
    });

  return (
    <Screen>
      {error && <Notice tone="error">{error}</Notice>}
      <Field
        label="What is happening?"
        placeholder="e.g. Phones are down at the main office"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        autoFocus
      />
      <Choices
        label="How bad is it?"
        value={impact}
        onChange={setImpact}
        options={IMPACTS.map((i) => ({ value: i, label: IMPACT_LABEL[i] }))}
        colorFor={(i) => t.status[IMPACT_TO_COMPONENT[i]]}
      />
      {components.length > 0 && (
        <Choices
          label="Which services are affected?"
          value={affected}
          onChange={toggle}
          options={components.map((c) => ({ value: c.id, label: c.name }))}
        />
      )}
      {affected.length > 0 && (
        <Notice>
          {affected.length === 1 ? 'That service' : 'Those services'} will show as “
          {COMPONENT_LABEL[IMPACT_TO_COMPONENT[impact]]}” until you resolve this incident.
        </Notice>
      )}
      <Field
        label="Message to customers"
        placeholder="What you know so far, and when you will update next."
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
      />
      <Button
        title={reach > 0 ? `Publish and alert ${reach.toLocaleString()} subscriber${reach === 1 ? '' : 's'}` : 'Publish'}
        onPress={publish}
        busy={busy}
        disabled={!ready}
      />
    </Screen>
  );
}
