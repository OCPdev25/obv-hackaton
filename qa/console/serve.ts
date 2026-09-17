/**
 * Tiny static server for the QA console fixture. Not product infrastructure —
 * it exists so the recording harness drives a stable origin (secure-context
 * crypto.subtle, no file:// quirks).
 */

const indexHtml = await Bun.file(new URL("./index.html", import.meta.url)).text()

export interface ConsoleServer {
  readonly url: string
  stop(): void
}

export function startConsoleServer(port = 0): ConsoleServer {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/console.js") {
        return new Response(Bun.file(new URL("./dist/console.js", import.meta.url)), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        })
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } })
      }
      return new Response("not found", { status: 404 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
