// Expo's Babel preset (React Native + web). Metro reads this file; Vitest does not.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
