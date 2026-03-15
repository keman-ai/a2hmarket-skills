#!/usr/bin/env python3
import argparse
import json
import time
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
    parser = argparse.ArgumentParser(description="Verify SkillHub mirror visibility for a ClawHub skill.")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--interval", type=int, default=15)
    parser.add_argument("--search-base", default="https://lightmake.site/api/v1/search")
    parser.add_argument("--download-base", default="https://lightmake.site/api/v1/download")
    args = parser.parse_args()

    deadline = time.time() + max(args.timeout, 1)
    matched = None

    while time.time() < deadline:
        search_url = args.search_base + "?" + urllib.parse.urlencode({"q": args.slug, "limit": 10})
        payload = fetch_json(search_url)
        for item in payload.get("results", []):
            if item.get("slug") == args.slug and item.get("version") == args.version:
                matched = item
                break
        if matched:
            break
        time.sleep(max(args.interval, 1))

    if not matched:
        raise SystemExit(f"SkillHub mirror not observed for {args.slug}@{args.version} within timeout")

    download_url = args.download_base + "?" + urllib.parse.urlencode({"slug": args.slug, "version": args.version})
    status, final_url, content_type = fetch_download(download_url)
    if status != 200:
        raise SystemExit(f"SkillHub download endpoint returned status {status}")
    if "zip" not in content_type.lower():
        raise SystemExit(f"unexpected SkillHub content-type: {content_type}")

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
