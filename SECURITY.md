# Security Policy

## Supported versions

Only the latest `main` branch is supported. Fixes are made there. If you run
a deployment, keep it up to date with `main`.

## Reporting a vulnerability

Please do not report security issues in a public GitHub issue, pull request,
or discussion.

Report them privately through GitHub's advisory form:

https://github.com/ctribuna/garmin-mcp/security/advisories/new

You can also reach it from the repository's **Security** tab, under
**Report a vulnerability**. Include what you found, the steps to reproduce it,
and the impact you expect. Please do not include real Garmin credentials or
real health data in the report.

The maintainer will acknowledge the report, look into it, and keep you
informed as work progresses. Once a fix is available, the advisory will be
published with credit to you if you want it.

## Scope

In scope:

- Authentication bypass on the MCP endpoint or the token upload endpoint.
- Leakage of Garmin session tokens, including through logs, responses, or
  error messages.
- Request forgery through the raw API tool, for example making the server
  call Garmin endpoints or internal URLs that the caller should not reach.

Out of scope:

- Problems in Garmin Connect itself. Report those to Garmin.
- Issues that require control of the deployer's Vercel or Upstash accounts.
- Social engineering of the maintainer or of users.

## Keep secrets out of reports and issues

Never post any of the following in an issue, pull request, or discussion:

- your `MCP_AUTH_TOKEN`
- your deployment's endpoint URL
- Garmin tokens, cookies, or the contents of `garmin_tokens.json`
- real health or activity data

If you have already shared one of these, rotate it right away. For
`MCP_AUTH_TOKEN`, generate a new value and update your deployment. For Garmin
tokens, sign out of the session and log in again.
