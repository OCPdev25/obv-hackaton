// Expo 57 defaults to the React Compiler; this scaffold keeps Babel minimal
// until that migration is intentional.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
  }
}
