export const CONVEX_URL_ENV_KEY = "EXPO_PUBLIC_CONVEX_URL"

/**
 * Resolve the Convex deployment URL for the mobile client. Set
 * EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env (see .env.example) to the dev
 * deployment URL shown by `npx convex dev`.
 */
export const getConvexClientUrl = (): string => {
  const url = process.env[CONVEX_URL_ENV_KEY]
  if (url === undefined || url.trim() === "") {
    throw new Error(
      `${CONVEX_URL_ENV_KEY} is not set — copy apps/mobile/.env.example to apps/mobile/.env and point it at your Convex dev deployment URL`
    )
  }
  return url
}
