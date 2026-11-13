import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, Notice, P, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { WEB_URL } from '@/lib/config';
import { useAction, useDashboard, useSession } from '@/lib/hooks';
import { SLUG_RE, slugify } from '@/lib/status';
import { font, space } from '@/theme';

/** First run for a new owner: name the business and claim a page code. */
export function Setup() {
  const { user } = useSession();
  const { reload } = useDashboard();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [email, setEmail] = useState(user?.email ?? '');
  const { busy, error, setError, run } = useAction();

  const code = slugEdited ? slug : slugify(name);
  const ready = name.trim().length >= 2 && SLUG_RE.test(code);

  const submit = () =>
    run(async () => {
      if (!(await api.slugAvailable(code))) {
        setError('That page code is already taken. Try another.');
        return;
      }
      await api.createOrg({ name: name.trim(), slug: code, support_email: email.trim() || null });
      await reload();
    });

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <P bold style={{ fontSize: font.display, lineHeight: 34 }}>
          Set up your status page
        </P>
        <P muted>Your customers will use the page code to find and follow you.</P>
      </View>

      {error && <Notice tone="error">{error}</Notice>}

      <Field label="Business name" value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
      <Field
        label="Page code"
        value={code}
        onChangeText={(v) => {
          setSlugEdited(true);
          setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        hint={
          WEB_URL
            ? `Your page: ${WEB_URL.replace(/^https?:\/\//, '')}/s/${code || 'your-code'} — this cannot be changed later.`
            : '3–40 letters, numbers or dashes. This cannot be changed later.'
        }
        error={code && !SLUG_RE.test(code) ? 'Use 3–40 lowercase letters, numbers or dashes.' : null}
      />
      <Field
        label="Support email (shown to customers)"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        hint="Optional"
      />

      <Button title="Create my status page" onPress={submit} busy={busy} disabled={!ready} />
      <Button title="Sign out" variant="link" onPress={() => api.signOut()} />
    </Screen>
  );
}
