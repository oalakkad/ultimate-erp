import { registerRootComponent } from 'expo';
import { App } from './src/core/app';

// Entry point for Android, iOS and web (Expo wires the platform-specific root for us).
registerRootComponent(App);
