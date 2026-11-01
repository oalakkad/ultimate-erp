// Expo's default Metro configuration already understands this pnpm monorepo (workspace root as
// a watch folder, symlinked packages). The shared packages are consumed from their built `dist`.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
