const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

// Monorepo: let Metro resolve workspace packages (@journal/contracts) and
// watch the repo root for changes.
const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]

module.exports = config
