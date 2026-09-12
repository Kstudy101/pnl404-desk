"""Exact daily-close momentum; no scores, probabilities or interpolated bars.

Stock windows count observed trading sessions. Crypto windows require consecutive
UTC closing boundaries. CoinGecko's undated sparkline cannot supply these dates;
daily market_chart values are fetched once per new completed UTC day instead.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
import math
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = (7, 14, 21, 28)
# Keyless CoinGecko has a shared, dynamic IP limit. Actual 2.2-second pacing
# returned HTTP 429; leave headroom for the separate top-100 price request.
CRYPTO_MIN_INTERVAL = 16.0
RATE_LIMIT_COOLDOWN = 120


def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def utc_now() -> str:
    return iso(datetime.now(timezone.utc))


def filename(identifier: str) -> str:
    if not re.fullmatch(r"(?:us|kr|jp|crypto):[A-Za-z0-9][A-Za-z0-9.^=-]{0,90}", identifier):
        raise ValueError("Invalid instrument ID")
    return identifier.replace(":", "_") + ".json"


def numeric(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def completed_crypto_boundary(calculated_at: str) -> datetime:
    now = instant(calculated_at)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # CoinGecko documents publication of the last completed day at 00:10 UTC.
    return midnight if now >= midnight + timedelta(minutes=10) else midnight - timedelta(days=1)


def stock_cutoff(market: str, calculated_at: str) -> date:
    zone = {"us": "America/New_York", "kr": "Asia/Seoul", "jp": "Asia/Tokyo"}[market]
    local = instant(calculated_at).astimezone(ZoneInfo(zone))
    ready = (local.hour, local.minute) >= ((16, 30) if market == "us" else (16, 0))
    return local.date() + timedelta(days=1 if ready else 0)


def clean_points(item: dict, history: dict, calculated_at: str) -> tuple[list, bool]:
    """Return completed observations; conflicting dates/invalid prices are errors."""
    by_date, invalid = {}, False
    crypto = item["market"] == "crypto"
    boundary = completed_crypto_boundary(calculated_at) if crypto else None
    cutoff = None if crypto else stock_cutoff(item["market"], calculated_at)
    for point in history.get("points", []):
        try:
            stamp = instant(point["time"])
        except (KeyError, ValueError, TypeError, OverflowError):
            invalid = True
            continue
        if crypto:
            if stamp > boundary:
                continue
            if (stamp.hour, stamp.minute, stamp.second, stamp.microsecond) != (0, 0, 0, 0):
                invalid = True
                continue
        elif stamp.date() >= cutoff:
            continue
        value = numeric(point.get("value"))
        if value is None or value <= 0:
            invalid = True
            continue
        key = stamp.date().isoformat()
        if key in by_date and by_date[key]["value"] != value:
            invalid = True
        by_date[key] = {"time": iso(stamp), "value": value}
    return [by_date[key] for key in sorted(by_date)], invalid


def window_result(points: list, sessions: int, offset: int, crypto: bool, invalid: bool) -> dict:
    end_index = len(points) - 1 - offset
    start_index = end_index - sessions
    selected = points[max(0, start_index):end_index + 1] if end_index >= 0 else []
    result = {"return_pct": None, "direction": None, "start_close": None, "end_close": None, "start_at": selected[0]["time"] if selected else None,
              "end_at": selected[-1]["time"] if selected else None, "sessions": sessions,
              "observations": len(selected), "required_observations": sessions + 1, "status": "insufficient"}
    if invalid:
        result["status"] = "invalid"
        return result
    if start_index < 0:
        return result
    if crypto and any(instant(right["time"]) - instant(left["time"]) != timedelta(days=1) for left, right in zip(selected, selected[1:])):
        result["status"] = "gap"
        return result
    change = (selected[-1]["value"] / selected[0]["value"] - 1) * 100
    result.update(return_pct=change, direction="up" if change > 0 else "down" if change < 0 else "flat", status="ok", start_close=selected[0]["value"], end_close=selected[-1]["value"])
    return result


def calculate_momentum(item: dict, history: dict, calculated_at: str) -> dict:
    points, invalid = clean_points(item, history, calculated_at)
    invalid = invalid or bool(history.get("id") and history["id"] != item["id"])
    crypto = item["market"] == "crypto"
    as_of = points[-1]["time"] if points else None
    last_bar_date = (instant(as_of).date() - timedelta(days=1 if crypto else 0)).isoformat() if as_of else None
    stale = bool(history.get("stale")) or bool(item.get("stale"))
    if crypto and (not as_of or instant(as_of) < completed_crypto_boundary(calculated_at)):
        stale = True
    return {"basis": "calendar_days" if crypto else "trading_days", "price_basis": "daily_close", "as_of": as_of,
            "last_bar_date": last_bar_date, "calculated_at": calculated_at, "data_fetched_at": history.get("fetched_at"),
            "source": history.get("source"), "stale": stale,
            "periods": {str(days): window_result(points, days, 0, crypto, invalid) for days in WINDOWS},
            "blocks": [{"label": f"{index + 1}구간", **window_result(points, 7, offset, crypto, invalid)} for index, offset in enumerate((21, 14, 7, 0))]}


def read_history(directory: Path, item: dict) -> dict:
    try:
        value = json.loads((directory / filename(item["id"])).read_text(encoding="utf-8"))
        return value if value.get("id") == item["id"] and isinstance(value.get("points"), list) else {}
    except (OSError, ValueError, TypeError):
        return {}


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def daily_crypto_history(item: dict, payload: dict, fetched_at: str, previous: dict | None = None) -> dict:
    previous = previous or {}
    boundary = completed_crypto_boundary(fetched_at)
    merged = {point["time"]: point for point in previous.get("points", [])}
    received = 0
    for row in payload.get("prices", []):
        if not isinstance(row, list) or len(row) < 2 or numeric(row[0]) is None:
            continue
        stamp = datetime.fromtimestamp(float(row[0]) / 1000, timezone.utc)
        value = numeric(row[1])
        # The daily endpoint also appends the current intraday price. Keep only
        # provider-stamped 00:00 UTC observations, without rounding timestamps.
        if stamp > boundary or (stamp.hour, stamp.minute, stamp.second, stamp.microsecond) != (0, 0, 0, 0) or value is None or value <= 0:
            continue
        merged[iso(stamp)] = {"time": iso(stamp), "value": value, "bar_date": (stamp.date() - timedelta(days=1)).isoformat()}
        received += 1
    if not received:
        raise ValueError("CoinGecko returned no completed UTC daily observations")
    cutoff = boundary - timedelta(days=65)
    points = [point for key, point in sorted(merged.items()) if instant(key) >= cutoff and instant(key) <= boundary]
    latest = points[-1]["time"]
    return {"id": item["id"], "currency": "USD", "points": points, "updated_at": latest,
            "fetched_at": fetched_at, "generated_at": fetched_at, "next_refresh_at": iso(boundary + timedelta(days=1, minutes=10)),
            "source": "CoinGecko (UTC 일봉)", "stale": instant(latest) < boundary, "interval": "1d", "price_basis": "daily_close",
            "daily_checked_for": iso(boundary), "notes": ["CoinGecko가 제공한 UTC 00:00 가격입니다. 해당 시각에 완료된 전날의 일봉이며 진행 중인 값과 날짜 없는 spark는 제외합니다."]}


def fetch_crypto_daily(identifier: str) -> dict:
    coin = identifier.split(":", 1)[1]
    url = f"https://api.coingecko.com/api/v3/coins/{urllib.parse.quote(coin, safe='')}/market_chart?vs_currency=usd&days=35&interval=daily"
    request = urllib.request.Request(url, headers={"User-Agent": "PNL404-Momentum/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def retry_after_seconds(value, received_at: str) -> int | None:
    """RFC 9110 Retry-After: non-negative seconds or an HTTP-date."""
    value = str(value or "").strip()
    if re.fullmatch(r"[0-9]+", value):
        return int(value)
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return max(0, math.ceil((parsed - instant(received_at)).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return None


def cooldown_seconds(previous: dict, checked_at: str) -> int:
    try:
        return max(0, math.ceil((instant(previous["cooldown_until"]) - instant(checked_at)).total_seconds()))
    except (KeyError, TypeError, ValueError, OverflowError):
        return 0


def refresh_crypto_histories(items: list, directory: Path, calculated_at: str, budget: int = 100,
                             min_interval: float = CRYPTO_MIN_INTERVAL, fetcher=fetch_crypto_daily, sleeper=time.sleep, clock=None,
                             previous_collection: dict | None = None) -> dict:
    started = time.monotonic()
    previous_collection = previous_collection or {}
    boundary = completed_crypto_boundary(calculated_at)
    candidates = []
    for item in items:
        if item["market"] != "crypto":
            continue
        old = read_history(directory, item)
        if old.get("daily_checked_for") == iso(boundary) and not old.get("stale"):
            continue
        candidates.append((item, old))
    candidates.sort(key=lambda pair: (pair[1].get("updated_at") or "", pair[0].get("market_cap_rank") or 10000))
    report = {"due": len(candidates), "attempted": 0, "updated": 0, "failed": 0, "deferred": 0, "errors": {},
              "min_interval_seconds": min_interval, "status": "complete"}
    remaining = cooldown_seconds(previous_collection, calculated_at)
    if remaining:
        report.update({key: previous_collection[key] for key in ("cooldown_until", "consecutive_rate_limits", "retry_after_seconds", "cooldown_source") if key in previous_collection})
        report.update(status="cooldown", deferred=len(candidates), cooldown_remaining_seconds=remaining, duration_seconds=0)
        return report
    previous_request = None
    for item, old in candidates[:max(0, budget)]:
        if previous_request is not None:
            sleeper(max(0, min_interval - (time.monotonic() - previous_request)))
        previous_request = time.monotonic()
        report["attempted"] += 1
        try:
            payload = fetcher(item["id"])
            history = daily_crypto_history(item, payload, clock() if clock else calculated_at, old)
            atomic_json(directory / filename(item["id"]), history)
            report["updated"] += 1
        except Exception as error:
            report["failed"] += 1
            report["errors"][item["id"]] = str(error)[:200]
            if old:
                atomic_json(directory / filename(item["id"]), {**old, "stale": True, "refresh_error": str(error)[:200], "checked_at": calculated_at})
            if isinstance(error, urllib.error.HTTPError) and error.code == 429:
                received_at = clock() if clock else calculated_at
                supplied = retry_after_seconds(error.headers.get("Retry-After") if error.headers else None, received_at)
                count = min(10, max(0, int(previous_collection.get("consecutive_rate_limits", 0)))) + 1
                # Do not retry inside this run. Persist backoff for the next run;
                # respect a longer provider delay, and double our fallback up to 1h.
                delay = max(supplied or 0, min(3600, RATE_LIMIT_COOLDOWN * (2 ** (count - 1))))
                report.update(consecutive_rate_limits=count, retry_after_seconds=supplied,
                              cooldown_until=iso(instant(received_at) + timedelta(seconds=delay)),
                              cooldown_source="retry_after_and_backoff" if supplied is not None else "application_backoff")
            if isinstance(error, urllib.error.HTTPError) and error.code in (401, 403, 429):
                break
    report["deferred"] = report["due"] - report["attempted"]
    report["status"] = "partial" if report["failed"] or report["deferred"] else "complete"
    if not budget and report["deferred"]:
        report["status"] = "disabled"
    report["duration_seconds"] = round(time.monotonic() - started, 3)
    return report


def annotate_snapshot(snapshot: dict, directory: Path, calculated_at: str, crypto_history_budget: int = 0,
                      crypto_min_interval: float = CRYPTO_MIN_INTERVAL) -> dict:
    collection = refresh_crypto_histories(snapshot["items"], directory, calculated_at, crypto_history_budget, crypto_min_interval,
                                          clock=utc_now, previous_collection=snapshot.get("momentum_collection"))
    if collection["attempted"]:
        calculated_at = utc_now()
    items = []
    for item in snapshot["items"]:
        history = read_history(directory, item)
        momentum = calculate_momentum(item, history, calculated_at)
        points, _ = clean_points(item, history, calculated_at)
        # Keep the raw spot quote distinct from this daily-price signal. Old 4h
        # scores live in data.json and are never copied into this signal.
        items.append({**item, "momentum": momentum, "history": [point["value"] for point in points[-30:]]})
    return {**snapshot, "items": items, "momentum_calculated_at": calculated_at,
            "momentum_config": {"windows": list(WINDOWS), "default_window": 7, "maximum_window": 28,
                                "formula": "(last_close / close_N_observations_ago - 1) * 100", "stocks": "trading_days", "crypto": "continuous_utc_days"},
            "momentum_collection": {**collection, "available_7": sum(item["momentum"]["periods"]["7"]["status"] == "ok" for item in items),
                                    "available_28": sum(item["momentum"]["periods"]["28"]["status"] == "ok" for item in items)}}


def main(argv=None):
    started = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path, default=ROOT / "public/modules/board/markets.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/modules/board/markets.json")
    parser.add_argument("--history-dir", type=Path, default=ROOT / "public/modules/board/history")
    parser.add_argument("--symbols")
    parser.add_argument("--crypto-history-budget", type=int, default=0)
    parser.add_argument("--crypto-min-interval", type=float, default=CRYPTO_MIN_INTERVAL)
    args = parser.parse_args(argv)
    if args.symbols and (args.output.resolve() == (ROOT / "public/modules/board/markets.json").resolve() or
                         args.history_dir.resolve() == (ROOT / "public/modules/board/history").resolve()):
        parser.error("Bounded smoke runs require isolated --output and --history-dir")
    if args.crypto_history_budget < 0 or args.crypto_history_budget > 100 or args.crypto_min_interval < 2:
        parser.error("Crypto budget must be 0..100 and interval must be at least 2 seconds")
    snapshot = json.loads(args.catalogue.read_text(encoding="utf-8"))
    if args.symbols:
        identifiers = set(args.symbols.split(","))
        snapshot["items"] = [item for item in snapshot["items"] if item["id"] in identifiers]
        if len(snapshot["items"]) != len(identifiers):
            parser.error("One or more symbols are absent from the catalogue")
    payload = annotate_snapshot(snapshot, args.history_dir, utc_now(), args.crypto_history_budget, args.crypto_min_interval)
    atomic_json(args.output, payload)
    collection = payload["momentum_collection"]
    partial = bool(collection["failed"] or (args.crypto_history_budget and collection["deferred"]))
    print(json.dumps({"status": "partial" if partial else "offline_only" if not args.crypto_history_budget else "complete",
                      "output": str(args.output.resolve()), "items": len(payload["items"]), "momentum_collection": collection,
                      "duration_seconds": round(time.monotonic() - started, 3)}, ensure_ascii=False))
    return 2 if partial else 0


if __name__ == "__main__":
    raise SystemExit(main())
