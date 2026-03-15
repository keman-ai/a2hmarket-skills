#!/usr/bin/env python3
import argparse
import json
import urllib.parse
import urllib.request


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def fetch_download(url: str) -> tuple[int, str, str]:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.status, response.geturl(), response.headers.get("Content-Type", "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a published ClawHub release.")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--registry", default="https://clawhub.ai")
    args = parser.parse_args()

    skill_url = f"{args.registry.rstrip('/')}/api/v1/skills/{args.slug}"
    data = fetch_json(skill_url)
    latest = ((data.get("latestVersion") or {}).get("version") or "").strip()
    if latest != args.version:
        raise SystemExit(f"expected latestVersion={args.version}, got {latest or '<empty>'}")

    download_url = (
        f"{args.registry.rstrip('/')}/api/v1/download?"
        + urllib.parse.urlencode({"slug": args.slug, "version": args.version})
    )
    status, final_url, content_type = fetch_download(download_url)
    if status != 200:
        raise SystemExit(f"download endpoint returned status {status}")
    if "zip" not in content_type.lower():
        raise SystemExit(f"unexpected content-type: {content_type}")

    print(
        json.dumps(
            {
                "slug": args.slug,
                "version": args.version,
                "downloadUrl": final_url,
                "contentType": content_type,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
