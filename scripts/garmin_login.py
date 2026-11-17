# /// script
# requires-python = ">=3.10"
# dependencies = ["garminconnect>=0.3.20", "curl_cffi>=0.15.0"]
# ///
"""Log in to Garmin Connect on your own computer and hand the tokens to the server.

Garmin's login is protected against datacenter IPs and non-browser clients, so
it cannot run on Vercel. Run this locally instead; it needs to be repeated only
if the server reports that its Garmin session is no longer valid.

    uv run scripts/garmin_login.py --url https://your-app.vercel.app

Your Garmin password is sent only to Garmin. The server receives the resulting
session tokens, which it stores encrypted.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from garminconnect import Garmin


def login(email: str, password: str) -> str:
    """Log in (prompting for an MFA code if needed) and return the token JSON."""
    with tempfile.TemporaryDirectory() as tokenstore:
        garmin = Garmin(email, password, prompt_mfa=lambda: input("Garmin MFA code: ").strip())
        garmin.login(tokenstore)
        return (Path(tokenstore) / "garmin_tokens.json").read_text(encoding="utf-8")


def upload(url: str, secret: str, tokens: str) -> dict:
    request = urllib.request.Request(
        url.rstrip("/") + "/api/admin/tokens",
        data=tokens.encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(body).get("error", body)
        except ValueError:
            detail = body[:300]
        sys.exit(f"Upload failed (HTTP {error.code}): {detail}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach {url}: {error.reason}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("GARMIN_MCP_URL"), help="Base URL of your deployment, e.g. https://your-app.vercel.app (or set GARMIN_MCP_URL)")
    parser.add_argument("--email", default=os.environ.get("GARMIN_EMAIL"), help="Garmin account email (or set GARMIN_EMAIL)")
    parser.add_argument("--print", action="store_true", dest="print_tokens", help="Print the tokens instead of uploading them (for the GARMIN_TOKENS env var)")
    args = parser.parse_args()

    if not args.print_tokens and not args.url:
        parser.error("--url is required unless --print is used")
    if args.url and not args.url.startswith("https://") and not args.url.startswith("http://localhost"):
        parser.error("--url must start with https://")

    email = args.email or input("Garmin email: ").strip()
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin password: ")
    secret = None
    if not args.print_tokens:
        secret = os.environ.get("MCP_AUTH_TOKEN") or getpass.getpass("MCP_AUTH_TOKEN of your deployment: ").strip()

    print("Logging in to Garmin (this can take up to a minute)...", file=sys.stderr)
    tokens = login(email, password)

    if args.print_tokens:
        print(tokens)
        return

    result = upload(args.url, secret, tokens)
    print(f"Connected Garmin account: {result.get('account')} (storage: {result.get('storage')})")
    if result.get("warning"):
        print(f"Warning: {result['warning']}")


if __name__ == "__main__":
    main()
