import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, Choices, Field, Notice, Screen, confirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction, useReadyDashboard } from '@/lib/hooks';
import { COMPONENT_LABEL, COMPONENT_STATUSES } from '@/lib/status';
import type { ComponentStatus } from '@/lib/types';
import { useTheme } from '@/theme';

/** Add a service (no id) or edit one (?id=). */
export default function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const t = useTheme();
  const router = useRouter();
  const { org, components, reload } = useReadyDashboard();
  const existing = components.find((c) => c.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [status, setStatus] = useState<ComponentStatus>(existing?.status ?? 'operational');
  const { busy, error, run } = useAction();

  const done = async () => {
    await reload();
    router.back();
  };

  const save = () =>
    run(async () => {
      if (existing) await api.updateComponent(existing.id, { name: name.trim(), status });
      else await api.addComponent(org.id, name.trim(), components.length);
      await done();
    });

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm('Delete this service?', `“${existing.name}” will be removed from your status page.`, 'Delete');
    if (ok) run(async () => (await api.deleteComponent(existing.id), await done()));
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? 'Edit service' : 'Add a service' }} />
      {error && <Notice tone="error">{error}</Notice>}
      <Field
        label="Service name"
        placeholder="e.g. Online ordering"
        hint="Name it the way your customers would."
        value={name}
        onChangeText={setName}
        maxLength={60}
        autoFocus={!existing}
      />
      {existing && (
        <Choices
          label="Current status"
          value={status}
          onChange={setStatus}
          options={COMPONENT_STATUSES.map((s) => ({ value: s, label: COMPONENT_LABEL[s] }))}
          colorFor={(s) => t.status[s]}
        />
      )}
      {existing && status !== existing.status && (
        <Notice>
          Changing the status here updates your page quietly. To alert subscribers, report an incident instead.
        </Notice>
      )}
      <Button title={existing ? 'Save' : 'Add service'} onPress={save} busy={busy} disabled={!name.trim()} />
      {existing && <Button title="Delete service" variant="danger" onPress={remove} disabled={busy} />}
    </Screen>
  );
}
