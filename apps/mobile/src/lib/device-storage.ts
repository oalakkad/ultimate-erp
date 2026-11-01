import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { type KeyValueStore, memoryStore } from './storage';

/** Secure store on phones; localStorage in the browser preview; memory if neither exists. */
export function deviceStore(): KeyValueStore {
  if (Platform.OS === 'web') {
    const local = typeof localStorage === 'undefined' ? null : localStorage;
    if (!local) return memoryStore();
    return {
      get: (key) => Promise.resolve(local.getItem(key)),
      set: (key, value) => {
        local.setItem(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        local.removeItem(key);
        return Promise.resolve();
      },
    };
  }
  return {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    delete: (key) => SecureStore.deleteItemAsync(key),
  };
}
