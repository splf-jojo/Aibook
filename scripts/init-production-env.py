#!/usr/bin/env python3
"""Create a complete production environment file with generated secrets."""

from __future__ import annotations

import argparse
import ipaddress
import secrets
from pathlib import Path
from urllib.parse import urlsplit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / ".env.production"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create .env.production and generate database/JWT secrets. "
            "The Qwen API key is intentionally left empty."
        )
    )
    parser.add_argument(
        "--public-url",
        default="http://localhost",
        help=(
            "Public site address. Use an IP/localhost for temporary HTTP testing "
            "or a domain for automatic HTTPS. Default: http://localhost"
        ),
    )
    parser.add_argument(
        "--acme-email",
        help="Certificate account email. If omitted, a safe placeholder is used.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Environment file path. Default: project .env.production",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing output file and generate new secrets.",
    )
    return parser.parse_args()


def normalize_public_address(value: str) -> tuple[str, str, str]:
    value = value.strip().rstrip("/")
    if not value:
        raise ValueError("--public-url cannot be empty")

    has_scheme = "://" in value
    parsed = urlsplit(value if has_scheme else f"//{value}")
    host = parsed.hostname
    if not host:
        raise ValueError("--public-url must contain a valid host")

    try:
        is_ip = ipaddress.ip_address(host) is not None
    except ValueError:
        is_ip = False

    if has_scheme:
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("--public-url scheme must be http or https")
        caddy_address = value
        browser_origin = value
    elif host == "localhost" or is_ip:
        caddy_address = f"http://{value}"
        browser_origin = caddy_address
    else:
        caddy_address = value
        browser_origin = f"https://{value}"

    return caddy_address, browser_origin, host


def main() -> int:
    args = parse_args()
    output = args.output.expanduser().resolve()
    if output.exists() and not args.force:
        raise SystemExit(
            f"Refusing to overwrite {output}. Use --force to rotate every secret."
        )

    existing_qwen_key = ""
    if output.exists():
        for line in output.read_text(encoding="utf-8-sig").splitlines():
            if line.startswith("API_KEY="):
                existing_qwen_key = line.partition("=")[2]
                break

    try:
        api_domain, cors_origin, host = normalize_public_address(args.public_url)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    default_email = "admin@example.com"
    if "." in host and host != "localhost":
        try:
            ipaddress.ip_address(host)
        except ValueError:
            default_email = f"admin@{host}"
    acme_email = (args.acme_email or default_email).strip()
    if not acme_email or "@" not in acme_email:
        raise SystemExit("--acme-email must be a valid email address")

    values = {
        "API_DOMAIN": api_domain,
        "ACME_EMAIL": acme_email,
        "POSTGRES_DB": "aibook",
        "POSTGRES_USER": "aibook",
        "POSTGRES_PASSWORD": secrets.token_hex(32),
        "JWT_SECRET": secrets.token_hex(64),
        "ACCESS_TOKEN_MINUTES": "10080",
        "CORS_ORIGINS": cors_origin,
        "API_KEY": existing_qwen_key,
        "QWEN_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "QWEN_MODEL": "qwen3.8-flash",
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
        encoding="utf-8",
    )
    try:
        output.chmod(0o600)
    except OSError:
        pass

    print(f"Created {output}")
    print(f"Public address: {api_domain}")
    if existing_qwen_key:
        print("Qwen API key: preserved from the existing file")
    else:
        print("Qwen API key: empty (set API_KEY later)")
    print("Secrets were written to the file and were not printed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
