#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from urllib import request


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="MVP Evidence uploader (Tier1 CLI)")
    parser.add_argument("--server", default="http://localhost:8080")
    parser.add_argument("--file", required=True, help="JSON file containing either one evidence object or {items:[...]} for batch")
    args = parser.parse_args()

    payload = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "items" in payload:
        endpoint = f"{args.server}/v1/evidence/batch"
    else:
        endpoint = f"{args.server}/v1/evidence"

    result = post_json(endpoint, payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
