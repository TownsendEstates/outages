import { View } from 'react-native';

import { Card, P, Pill } from '@/components/ui';
import { IMPACT_LABEL, IMPACT_TO_COMPONENT, INCIDENT_LABEL, dateTime, timeAgo } from '@/lib/status';
import type { Component, Incident } from '@/lib/types';
import { space, useTheme } from '@/theme';

/** An incident with its full timeline of updates, newest first. */
export function IncidentCard({ incident, components }: { incident: Incident; components: Component[] }) {
  const t = useTheme();
  const resolved = incident.status === 'resolved';
  const color = resolved ? t.status.operational : t.status[IMPACT_TO_COMPONENT[incident.impact]];
  const affected = components.filter((c) => incident.component_ids.includes(c.id)).map((c) => c.name);

  return (
    <Card style={{ padding: space.lg, gap: space.md }}>
      <View style={{ gap: space.sm }}>
        <Pill label={resolved ? 'Resolved' : `${IMPACT_LABEL[incident.impact]} incident`} color={color} />
        <P bold style={{ fontSize: 18, lineHeight: 24 }}>
          {incident.title}
        </P>
        <P small muted>
          {affected.length ? `${affected.join(', ')} · ` : ''}
          Started {dateTime(incident.started_at)}
        </P>
      </View>

      <View>
        {incident.updates.map((u, n) => {
          const last = n === incident.updates.length - 1;
          return (
            <View key={u.id} style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ alignItems: 'center', width: 12 }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 12,
                    marginTop: 5,
                    backgroundColor: n === 0 ? color : t.border,
                  }}
                />
                {!last && <View style={{ flex: 1, width: 2, backgroundColor: t.border, marginVertical: 2 }} />}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : space.lg, gap: 2 }}>
                <P small>
                  <P small bold>
                    {INCIDENT_LABEL[u.status]}
                  </P>
                  <P small muted>
                    {'  ·  '}
                    {timeAgo(u.created_at)}
                  </P>
                </P>
                <P>{u.body}</P>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
