function createOAuthCallbackServer() {
  let server

  return {
    start(handler) {
      if (server) return
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: OAUTH_PORT,
        fetch: handler,
      })
    },
  }
}

const redirectUri = () => `http://127.0.0.1:${OAUTH_PORT}${OAUTH_REDIRECT_PATH}`
