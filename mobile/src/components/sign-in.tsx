import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, Notice, P, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { DEMO } from '@/lib/config';
import { useAction } from '@/lib/hooks';
import { font, space } from '@/theme';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

const COPY: Record<Mode, { title: string; lead: string; action: string }> = {
  signin: { title: 'Sign in', lead: 'Manage your status page and alert your customers.', action: 'Sign in' },
  signup: {
    title: 'Create your account',
    lead: 'Free to start. Publish a status page in about two minutes.',
    action: 'Create account',
  },
  forgot: { title: 'Reset your password', lead: 'We will email you a 6-digit code.', action: 'Email me a code' },
  reset: { title: 'Choose a new password', lead: 'Enter the code from the email we just sent.', action: 'Save and sign in' },
};

export function SignIn() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword('');
  };

  const address = email.trim().toLowerCase();
  const emailOk = /^\S+@\S+\.\S+$/.test(address);
  const passwordOk = password.length >= 8;
  const ready =
    mode === 'forgot' ? emailOk : mode === 'reset' ? emailOk && passwordOk && code.trim().length >= 6 : emailOk && passwordOk;

  const submit = () =>
    run(async () => {
      setInfo(null);
      if (mode === 'signin') {
        await api.signIn(address, password);
      } else if (mode === 'signup') {
        const mustConfirm = await api.signUp(address, password);
        if (mustConfirm) {
          go('signin');
          setInfo(`We sent a confirmation link to ${address}. Open it, then sign in here.`);
        }
      } else if (mode === 'forgot') {
        await api.requestPasswordReset(address);
        go('reset');
        setInfo(`If ${address} has an account, a code is on its way.`);
      } else {
        await api.resetPassword(address, code.trim(), password);
      }
    });

  const copy = COPY[mode];
  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <P bold style={{ fontSize: font.display, lineHeight: 34 }}>
          {copy.title}
        </P>
        <P muted>{copy.lead}</P>
      </View>

      {DEMO && <Notice>Demo mode — any email and an 8-character password will sign you in to the sample business.</Notice>}
      {info && <Notice>{info}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      {mode === 'reset' && (
        <Field
          label="Code from the email"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={8}
        />
      )}
      {mode !== 'forgot' && (
        <Field
          label={mode === 'reset' ? 'New password' : 'Password'}
          hint={mode === 'signin' ? undefined : 'At least 8 characters'}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          textContentType={mode === 'signin' ? 'password' : 'newPassword'}
          returnKeyType="go"
          onSubmitEditing={() => ready && submit()}
        />
      )}

      <Button title={copy.action} onPress={submit} busy={busy} disabled={!ready} />

      <View>
        {mode === 'signin' ? (
          <>
            <Button title="New here? Create an account" variant="link" onPress={() => go('signup')} />
            <Button title="Forgot your password?" variant="link" onPress={() => go('forgot')} />
          </>
        ) : (
          <Button title="Back to sign in" variant="link" onPress={() => go('signin')} />
        )}
      </View>
    </Screen>
  );
}
