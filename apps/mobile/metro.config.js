const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so workspace package edits retrigger bundles.
config.watchFolders = [workspaceRoot]

// Resolve from the app first, then the workspace root (pnpm layout).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]

// Workspace packages ship TypeScript source (exports → src/index.ts).
config.transpilePackages = ["@journal/domain", "@journal/capture"]

// Intra-package imports use `.js` specifiers (Node-ESM style) while the files
// are `.ts` source; metro has no extension aliasing, so try `.ts` on a miss.
config.resolver.resolveRequest = (context, specifier, platform) => {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const tsSpecifier = specifier.slice(0, -3) + ".ts"
    try {
      return context.resolveRequest({ ...context, resolveRequest: undefined }, tsSpecifier, platform)
    } catch {
      // fall through to the default resolver
    }
  }
  return context.resolveRequest(context, specifier, platform)
}

module.exports = config
