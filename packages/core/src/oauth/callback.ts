import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { OauthCallbackPage } from "./page"

export interface CallbackResult {
  code: string
  state: string
}

export interface Listener {
  waitForCallback(): Promise<CallbackResult>
  close(): Promise<void>
}

export function startOAuthListener(options: { port: number; path: string; state?: string; timeoutMs?: number }): Promise<Listener> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  let server: ReturnType<typeof createServer> | undefined

  let resolveCallback: (result: CallbackResult) => void
  let rejectCallback: (error: Error) => void
  let timeoutHandle: NodeJS.Timeout

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  timeoutHandle = setTimeout(() => {
    cleanup()
    rejectCallback(new Error("Timed out waiting for OAuth callback"))
  }, timeoutMs)

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (server) {
      server.close()
      server = undefined
    }
  }

  const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${options.port}`)

    if (url.pathname !== options.path) {
      res.writeHead(404)
      res.end("Not found")
      return
    }

    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")
    const errorDescription = url.searchParams.get("error_description")

    if (options.state && state !== options.state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.error("State parameter mismatch. Possible CSRF attack detected.", { provider: "Google Antigravity" }))
      rejectCallback(new Error("State parameter mismatch in OAuth callback"))
      cleanup()
      return
    }

    if (error) {
      const errorMsg = errorDescription || error
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.error(errorMsg, { provider: "Google Antigravity" }))
      rejectCallback(new Error(errorMsg))
      cleanup()
      return
    }

    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(OauthCallbackPage.error("Missing required code or state parameter", { provider: "Google Antigravity" }))
      rejectCallback(new Error("Missing code or state in OAuth callback"))
      cleanup()
      return
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(OauthCallbackPage.success({ provider: "Google Antigravity" }))
    resolveCallback({ code, state })
    cleanup()
  }

  server = createServer(handleRequest)

  return new Promise<Listener>((resolve, reject) => {
    server!.listen(options.port, "127.0.0.1", () => {
      resolve({
        waitForCallback: () => callbackPromise,
        close: () =>
          new Promise<void>((res) => {
            cleanup()
            res()
          }),
      })
    })
    server!.on("error", (err: NodeJS.ErrnoException) => {
      cleanup()
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${options.port} is already in use. Another process is occupying this port. Please terminate the process and try again.`))
      } else {
        reject(err)
      }
    })
  })
}
