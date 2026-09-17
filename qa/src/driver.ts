import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

/**
 * Capture policy (autobuild-qa rule 1): the viewport is fixed at 1440×900
 * and set before any capture — never the size the browser happened to open
 * with. 900px shorter edge also clears the 720px submission minimum.
 */
export const VIEWPORT = { width: 1440, height: 900 } as const

export interface Driver {
  readonly page: Page
  readonly browserVersion: string
  /** Closes the context (flushes the session video) and the browser. */
  close(): Promise<{ videoPath: string | null; consoleErrors: readonly string[] }>
}

export interface DriverOptions {
  /** Directory where Playwright buffers the session video before close. */
  readonly videoDir: string
  readonly baseUrl: string
}

export async function launchDriver(opts: DriverOptions): Promise<Driver> {
  const browser: Browser = await chromium.launch()
  const context: BrowserContext = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: opts.videoDir, size: VIEWPORT },
  })
  const consoleErrors: string[] = []
  const page = await context.newPage()
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console.error: ${msg.text()}`)
  })
  await page.goto(opts.baseUrl, { waitUntil: "load" })
  const browserVersion = browser.version()
  return {
    page,
    browserVersion,
    async close() {
      const video = page.video()
      await context.close()
      const videoPath = video === null ? null : await video.path()
      await browser.close()
      return { videoPath, consoleErrors }
    },
  }
}
