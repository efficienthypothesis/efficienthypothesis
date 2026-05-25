# MCP Notes

## AWS API Gateway auth challenge header

Production smoke testing on 2026-05-25 showed that unauthenticated MCP
`tools/call` requests correctly return HTTP 401, but API Gateway remaps the
standard `WWW-Authenticate` response header to
`x-amzn-remapped-www-authenticate`.

The OAuth discovery metadata endpoints are live and return HTTP 200:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`

If ChatGPT Developer Mode has trouble starting OAuth, check whether it requires
the literal `WWW-Authenticate` header on the 401 response. If so, the fix may
need to happen at the API Gateway/CloudFront layer rather than inside Flask.
