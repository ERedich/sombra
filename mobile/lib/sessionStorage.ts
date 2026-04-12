import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { AUTH_STORAGE_KEYS, type AuthUser, normalizeAuthUser } from '@sombra/shared';

const { token: TOKEN_KEY, user: USER_KEY } = AUTH_STORAGE_KEYS

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
    }
    return
  }
  await SecureStore.setItemAsync(key, value)
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  }
  return SecureStore.getItemAsync(key)
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key)
    }
    return
  }
  await SecureStore.deleteItemAsync(key)
}

export async function getToken(): Promise<string | null> {
  return getItem(TOKEN_KEY)
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await getItem(USER_KEY)
  if (!raw) return null
  try {
    return normalizeAuthUser(JSON.parse(raw) as AuthUser & { key?: string })
  } catch {
    return null
  }
}

export async function setSession(token: string, user: AuthUser): Promise<void> {
  const normalized = normalizeAuthUser({ ...user })
  await setItem(TOKEN_KEY, token)
  await setItem(USER_KEY, JSON.stringify(normalized))
}

export async function clearSession(): Promise<void> {
  await deleteItem(TOKEN_KEY)
  await deleteItem(USER_KEY)
}
