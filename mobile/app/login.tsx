import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import { apiBaseUrl } from '@/lib/config';
import {
  RNActivityIndicator,
  RNKeyboardAvoidingView,
  RNTextInput,
} from '@/lib/rnJsx';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    setMessage(null);
    if (!apiBaseUrl) {
      setMessage(
        'Set EXPO_PUBLIC_API_URL (see mobile/.env.example).',
      );
      return;
    }
    setBusy(true);
    try {
      const { parallel_session_warning } = await signIn(
        loginName.trim(),
        password,
      );
      if (parallel_session_warning) {
        Alert.alert(
          'Another session is active',
          'You are already signed in elsewhere. Using multiple sessions at once may cause inconsistent data or unexpected behaviour.',
        );
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setMessage(e.message);
      } else {
        setMessage(e instanceof Error ? e.message : 'Sign in failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <RNKeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.outer}>
      <View style={styles.card}>
        <Text style={styles.title}>Sombra</Text>
        <Text style={styles.hint}>Sign in with your CMMS account</Text>
        <RNTextInput
          style={styles.input}
          placeholder="Login name or email"
          placeholderTextColor="#888"
          autoCapitalize="none"
          autoCorrect={false}
          value={loginName}
          onChangeText={setLoginName}
          editable={!busy}
        />
        <RNTextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#888"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={busy}>
          {busy ? (
            <RNActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonLabel}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </RNKeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  hint: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: {
    color: '#c62828',
    fontSize: 14,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
