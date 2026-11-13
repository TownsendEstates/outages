import { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { Button, Card, H, Notice, P, Pill, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { billingAvailable, getPackages, managementUrl, purchase, restore, type Packages } from '@/lib/billing';
import { DEMO, PRIVACY_URL, TERMS_URL } from '@/lib/config';
import { useAction, useReadyDashboard } from '@/lib/hooks';
import { PLANS, planName } from '@/lib/plans';
import type { Plan } from '@/lib/types';
import { space, useTheme } from '@/theme';

const store = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Plans() {
  const t = useTheme();
  const { org, reload } = useReadyDashboard();
  const [packages, setPackages] = useState<Packages>({});
  const [pending, setPending] = useState<Plan | 'restore' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { error, run } = useAction();

  useEffect(() => {
    if (billingAvailable) getPackages(org.id).then(setPackages).catch(() => {});
  }, [org.id]);

  const act = (key: Plan | 'restore', fn: () => Promise<void>) => {
    setPending(key);
    setNote(null);
    return run(fn).finally(() => setPending(null));
  };

  // The store confirms to our server through a webhook, which can trail the
  // purchase sheet by a few seconds. Poll briefly rather than trusting the client.
  const waitForPlan = async (plan: Plan) => {
    for (let n = 0; n < 8; n++) {
      if ((await api.getDashboard())?.org.plan === plan) return reload();
      await wait(1500);
    }
    setNote('Your purchase went through. It can take a minute to show here — pull down on the dashboard to refresh.');
  };

  const choose = (plan: Exclude<Plan, 'free'>) =>
    act(plan, async () => {
      if (DEMO) {
        await api.demoSetPlan?.(plan);
        await reload();
        return;
      }
      const pkg = packages[plan];
      if (!pkg) throw new Error(`This plan is not available from the ${store} right now. Please try again later.`);
      if (await purchase(org.id, pkg)) await waitForPlan(plan);
    });

  const restorePurchases = () =>
    act('restore', async () => {
      const plan = await restore(org.id);
      if (plan === 'free') setNote('No active subscription was found for this account.');
      else await waitForPlan(plan);
    });

  const manage = () =>
    act(org.plan, async () => {
      if (DEMO) {
        await api.demoSetPlan?.('free');
        await reload();
        return;
      }
      const url = await managementUrl(org.id);
      if (url) await Linking.openURL(url);
      else setNote(`Manage or cancel your subscription in your ${store} account settings.`);
    });

  const canBuy = DEMO || billingAvailable;

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <P>
          You are on the <P bold>{planName(org.plan)}</P> plan.
        </P>
        <P small muted>
          Following a status page is always free for your customers.
        </P>
      </View>

      {DEMO && <Notice>Demo mode — choosing a plan here is simulated. No payment is taken.</Notice>}
      {!canBuy && (
        <Notice>
          {Platform.OS === 'web'
            ? 'Subscriptions are bought and managed in the iOS or Android app. Sign in there to upgrade.'
            : 'Subscriptions are not set up in this build yet.'}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {note && <Notice>{note}</Notice>}

      {PLANS.map((plan) => {
        const current = plan.id === org.plan;
        const price = plan.id !== 'free' ? (packages[plan.id]?.product.priceString ?? null) : null;
        return (
          <Card
            key={plan.id}
            style={[{ padding: space.lg, gap: space.md }, current && { borderColor: t.accent, borderWidth: 2 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <P bold style={{ fontSize: 20 }}>
                  {plan.name}
                </P>
                <P small muted>
                  {plan.blurb}
                </P>
              </View>
              {current && <Pill label="Current plan" color={t.accent} />}
            </View>
            <P bold style={{ fontSize: 22 }}>
              {price ? `${price} / month` : plan.fallbackPrice}
            </P>
            <View style={{ gap: 6 }}>
              {plan.features.map((f) => (
                <View key={f} style={{ flexDirection: 'row', gap: space.sm }}>
                  <P style={{ color: t.status.operational }} bold>
                    ✓
                  </P>
                  <P style={{ flex: 1 }}>{f}</P>
                </View>
              ))}
            </View>
            {plan.id !== 'free' && !current && canBuy && (
              <Button
                title={`Choose ${plan.name}`}
                onPress={() => choose(plan.id as Exclude<Plan, 'free'>)}
                busy={pending === plan.id}
                disabled={pending !== null}
              />
            )}
            {plan.id !== 'free' && current && canBuy && (
              <Button
                title={DEMO ? 'Cancel (back to Free)' : 'Manage or cancel subscription'}
                variant="secondary"
                onPress={manage}
                busy={pending === plan.id}
                disabled={pending !== null}
              />
            )}
          </Card>
        );
      })}

      {billingAvailable && (
        <Button
          title="Restore purchases"
          variant="link"
          onPress={restorePurchases}
          busy={pending === 'restore'}
          disabled={pending !== null}
        />
      )}

      <View style={{ gap: space.sm }}>
        <H>The fine print</H>
        <P small muted>
          Paid plans are monthly subscriptions billed to your {Platform.OS === 'web' ? 'app store' : store} account.
          They renew automatically each month at the price shown until you cancel, which you can do at any time in
          your {Platform.OS === 'web' ? 'app store' : store} account settings; cancelling takes effect at the end of
          the period you have paid for. Prices are in your local currency and applicable taxes are added at checkout.
        </P>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {!!TERMS_URL && <Button title="Terms of use" variant="link" onPress={() => Linking.openURL(TERMS_URL)} />}
          {!!PRIVACY_URL && <Button title="Privacy policy" variant="link" onPress={() => Linking.openURL(PRIVACY_URL)} />}
        </View>
      </View>
    </Screen>
  );
}
