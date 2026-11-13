import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COMPONENT_LABEL } from '@/lib/status';
import type { ComponentStatus } from '@/lib/types';
import { font, radius, space, tint, useTheme } from '@/theme';

/** Scrolling page body. Content is capped at a readable width on tablets and web. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  top,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Full-bleed content above the padded body (e.g. a brand banner). */
  top?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined
        }>
        {top}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.centered, { backgroundColor: t.bg }]}>{children}</View>;
}

export function Loading() {
  const t = useTheme();
  return (
    <Centered>
      <ActivityIndicator color={t.muted} />
    </Centered>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

/** A tappable row inside a Card. Rows after the first get a divider. */
export function Row({
  children,
  onPress,
  first,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  first?: boolean;
  label?: string;
}) {
  const t = useTheme();
  const style = [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [style, pressed && { backgroundColor: t.sunken }]}>
      {children}
      <Text style={{ color: t.muted, fontSize: 22, marginLeft: space.sm }}>›</Text>
    </Pressable>
  );
}

export function H({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.h, { color: t.muted }, style]}>
      {children}
    </Text>
  );
}

export function P({
  children,
  muted,
  small,
  bold,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        { color: muted ? t.muted : t.text, fontSize: small ? font.small : font.body, lineHeight: small ? 18 : 23 },
        bold && { fontWeight: '600' },
        style,
      ]}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  color,
  onColor,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  busy?: boolean;
  disabled?: boolean;
  /** Overrides the fill for primary buttons (brand colour). */
  color?: string;
  onColor?: string;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const fill = variant === 'primary' ? (color ?? t.accent) : 'transparent';
  const ink =
    variant === 'primary' ? (onColor ?? t.onAccent) : variant === 'danger' ? t.danger : variant === 'link' ? t.accent : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        variant === 'link' && styles.buttonLink,
        { backgroundColor: fill, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        (variant === 'secondary' || variant === 'danger') && { borderWidth: 1, borderColor: t.border },
      ]}>
      {busy ? <ActivityIndicator color={ink} /> : <Text style={[styles.buttonText, { color: ink }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  error,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: t.text, fontSize: font.small, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: t.text,
            backgroundColor: t.surface,
            borderColor: error ? t.danger : focused ? t.accent : t.border,
          },
          input.multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
          input.style,
        ]}
      />
      {error ? (
        <Text style={{ color: t.danger, fontSize: font.small }}>{error}</Text>
      ) : hint ? (
        <Text style={{ color: t.muted, fontSize: font.small }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Pick one (or, with `multi`, several) from a short list. */
export function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
  colorFor,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | T[];
  onChange: (v: T) => void;
  colorFor?: (v: T) => string;
}) {
  const t = useTheme();
  const multi = Array.isArray(value);
  const isOn = (v: T) => (multi ? value.includes(v) : value === v);
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ color: t.text, fontSize: font.small, fontWeight: '600' }}>{label}</Text>
      <View style={styles.chips} accessibilityRole={multi ? undefined : 'radiogroup'}>
        {options.map((o) => {
          const on = isOn(o.value);
          const c = colorFor?.(o.value) ?? t.accent;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: on }}
              style={[
                styles.chip,
                { borderColor: on ? c : t.border, backgroundColor: on ? tint(c, 0.14) : t.surface },
              ]}>
              <Text style={{ color: on ? c : t.text, fontSize: 15, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />;
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: tint(color, 0.14) }]}>
      <Dot color={color} size={8} />
      <Text style={{ color, fontSize: font.small, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function StatusPill({ status }: { status: ComponentStatus }) {
  const t = useTheme();
  return <Pill label={COMPONENT_LABEL[status]} color={t.status[status]} />;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  const t = useTheme();
  const c = tone === 'error' ? t.danger : t.accent;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: tint(c, 0.1), borderColor: tint(c, 0.35) }]}>
      <Text style={{ color: t.text, fontSize: font.small, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

/** Alert.alert does nothing on web, so confirmations go through here. */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

const styles = StyleSheet.create({
  body: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    padding: space.lg,
    gap: space.lg,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  },
  h: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonLink: { minHeight: 44, paddingHorizontal: space.sm },
  buttonText: { fontSize: font.body, fontWeight: '700' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.body,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
});
