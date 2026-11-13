// Subscriptions are sold through the App Store and Google Play using
// RevenueCat. The store tells RevenueCat, RevenueCat calls our webhook, and
// the webhook sets organizations.plan. The app never sets a plan itself.
//
// RevenueCat setup this file expects:
//   entitlements:  "pro", "business"
//   current offering with packages whose identifiers are "pro" and "business"
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import { REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from './config';
import type { Plan } from './types';

const apiKey = Platform.select({ ios: REVENUECAT_IOS_KEY, android: REVENUECAT_ANDROID_KEY, default: '' });

/** In-app purchases only exist in the iOS and Android builds. */
export const billingAvailable = Platform.OS !== 'web' && !!apiKey;

type PaidPlan = Exclude<Plan, 'free'>;
export type Packages = Partial<Record<PaidPlan, PurchasesPackage>>;

let configuredFor: string | null = null;

async function purchases(orgId: string) {
  const { default: Purchases } = await import('react-native-purchases');
  if (!configuredFor) {
    Purchases.configure({ apiKey, appUserID: orgId });
  } else if (configuredFor !== orgId) {
    await Purchases.logIn(orgId);
  }
  configuredFor = orgId;
  return Purchases;
}

export async function getPackages(orgId: string): Promise<Packages> {
  const Purchases = await purchases(orgId);
  const offerings = await Purchases.getOfferings();
  const out: Packages = {};
  for (const pkg of offerings.current?.availablePackages ?? []) {
    if (pkg.identifier === 'pro' || pkg.identifier === 'business') out[pkg.identifier] = pkg;
  }
  return out;
}

/** Resolves false when the person backs out of the store sheet. */
export async function purchase(orgId: string, pkg: PurchasesPackage): Promise<boolean> {
  const Purchases = await purchases(orgId);
  try {
    await Purchases.purchasePackage(pkg);
    return true;
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

/** The plan the store says this organization holds right now. */
export async function restore(orgId: string): Promise<Plan> {
  const Purchases = await purchases(orgId);
  const info = await Purchases.restorePurchases();
  const active = info.entitlements.active;
  return active.business ? 'business' : active.pro ? 'pro' : 'free';
}

export async function managementUrl(orgId: string): Promise<string | null> {
  const Purchases = await purchases(orgId);
  return (await Purchases.getCustomerInfo()).managementURL;
}
