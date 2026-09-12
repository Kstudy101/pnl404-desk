"""Free swing-data collector: FinanceDataReader / yfinance -> board JSON.

Network libraries are imported only by loader functions. The normalization and
merge functions can be tested with offline fixtures without installing them.
This collector does not recalculate the separate legacy swing scores.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import importlib.metadata
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
REFRESH_SECONDS = 3600


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (ValueError, TypeError):
        return None
    return result if math.isfinite(result) else None


def next_refresh(fetched_at: str) -> str:
    return (datetime.fromisoformat(fetched_at.replace("Z", "+00:00")) + timedelta(seconds=REFRESH_SECONDS)).isoformat().replace("+00:00", "Z")


def history_filename(identifier: str) -> str:
    if not re.fullmatch(r"(?:us|kr|jp|crypto):[A-Za-z0-9][A-Za-z0-9.^=-]{0,90}", identifier):
        raise ValueError("Invalid namespaced instrument ID")
    return identifier.replace(":", "_") + ".json"


def normalize_daily(item: dict, rows: list[dict], fetched_at: str, source: str) -> tuple[dict, dict]:
    """Keep provider bar dates separate from when this collector fetched them."""
    dates = {}
    fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    # A provider may include today's still-forming daily bar. Accept it only
    # after the nominal local close plus 30 minutes. Early closes remain delayed
    # until the normal close; exchange holidays have no new provider bar.
    zone = {"us": "America/New_York", "kr": "Asia/Seoul", "jp": "Asia/Tokyo"}[item["market"]]
    local = fetched.astimezone(ZoneInfo(zone))
    ready_hour, ready_minute = (16, 30) if item["market"] == "us" else (16, 0)
    ready = (local.hour, local.minute) >= (ready_hour, ready_minute)
    cutoff = (local.date() + timedelta(days=1 if ready else 0)).isoformat()
    for row in rows:
        close = number(row.get("close"))
        try:
            day = date.fromisoformat(str(row.get("date", ""))[:10]).isoformat()
        except ValueError:
            continue
        if close is not None and close > 0 and day < cutoff:
            # Daily observations are identified by calendar day, not an invented
            # exchange closing timestamp. The basis is explicit in both payloads.
            dates[day] = {"time": f"{day}T00:00:00Z", "value": close}
    points = [dates[day] for day in sorted(dates)]
    if not points:
        raise ValueError(f"{item['id']}: no valid daily closes")
    last = points[-1]
    previous = points[-2]["value"] if len(points) > 1 else None
    result = {**item, "price": last["value"], "change_pct": (last["value"] / previous - 1) * 100 if previous else None,
              "updated_at": last["time"], "bar_date": last["time"][:10], "fetched_at": fetched_at,
              "source": source, "price_basis": "daily_close", "history": [point["value"] for point in points[-30:]], "stale": False}
    result.pop("refresh_error", None)
    # Market cap remains the last separately sourced observation, not a number
    # recomputed from daily prices or silently attributed to the new library.
    result["market_cap_source"] = item.get("market_cap_source") or item.get("source")
    result["market_cap_updated_at"] = item.get("market_cap_updated_at") or item.get("fetched_at")
    history = {"id": item["id"], "currency": item["currency"], "points": points, "updated_at": last["time"],
               "fetched_at": fetched_at, "generated_at": fetched_at, "next_refresh_at": next_refresh(fetched_at),
               "source": source, "stale": False, "interval": "1d", "price_basis": "daily_close",
               "notes": ["일봉 Close 값입니다. 당일 봉은 현지 정규장 종료 30분 후부터 반영합니다. 일봉 날짜는 체결 시각이 아닙니다."]}
    return result, history


def merge_snapshot(previous: dict, results: dict, errors: dict, fetched_at: str) -> dict:
    items = []
    for item in previous.get("items", []):
        if item["id"] in results:
            items.append(results[item["id"]][0])
        else:
            items.append({**item, "stale": True, "refresh_error": errors.get(item["id"], "이번 실행에서 수신하지 못했습니다.")})
    markets = []
    for market in previous.get("markets", []):
        subset = [item for item in items if item["market"] == market["id"]]
        markets.append({**market, "coverage": {**market.get("coverage", {}), "total": len(subset),
                        "available": sum(item.get("price") is not None for item in subset),
                        "refreshed": sum(not item.get("stale", False) for item in subset)}})
    return {**previous, "schema_version": 1, "collector": "python-finance-packages", "generated_at": fetched_at,
            "next_refresh_at": next_refresh(fetched_at), "stale": bool(errors) or len(results) < len(items), "items": items, "markets": markets,
            "notes": ["주식은 FinanceDataReader·yfinance 일봉, 암호화폐는 CoinGecko 시세를 사용합니다.",
                      "1시간마다 수신 여부를 확인합니다. 일봉 값은 거래일 데이터가 바뀔 때 변경됩니다.",
                      *[f"{key}: 이전 수신값 유지 · {value}" for key, value in list(errors.items())[:10]]],
            "collection": {"requested": len(items), "refreshed": len(results), "failed": len(items) - len(results)}}


def frame_rows(frame) -> list[dict]:
    if frame is None or frame.empty or "Close" not in frame.columns:
        return []
    return [{"date": index.date().isoformat(), "close": value} for index, value in frame["Close"].items()]


def load_stock_rows(items: list[dict], start: str, starts: dict | None = None) -> tuple[dict, dict]:
    rows, errors = {}, {}
    starts = starts or {}
    korean = [item for item in items if item["market"] == "kr"]
    if korean:
        import FinanceDataReader as fdr
        for item in korean:
            try:
                rows[item["id"]] = frame_rows(fdr.DataReader(item["symbol"].split(".")[0], starts.get(item["id"], start)))
            except Exception as error:
                errors[item["id"]] = str(error)[:200]
    international = [item for item in items if item["market"] in ("us", "jp")]
    if international:
        import yfinance as yf
        # Bound provider bursts. A failed symbol returns an empty frame and is
        # retained from the previous snapshot by the merge step.
        for offset in range(0, len(international), 40):
            batch = international[offset:offset + 40]
            try:
                batch_start = min(starts.get(item["id"], start) for item in batch)
                data = yf.download([item["symbol"] for item in batch], start=batch_start, interval="1d", group_by="ticker",
                                   auto_adjust=False, actions=False, threads=4, progress=False, timeout=20, multi_level_index=True)
                for item in batch:
                    try:
                        frame = data[item["symbol"]] if getattr(data.columns, "nlevels", 1) > 1 else data
                        rows[item["id"]] = frame_rows(frame)
                    except (KeyError, ValueError) as error:
                        errors[item["id"]] = str(error)[:200]
            except Exception as error:
                errors.update({item["id"]: str(error)[:200] for item in batch})
    return rows, errors


def get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "PNL404-SwingCollector/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def load_crypto(items: list[dict], fetched_at: str, restrict: bool = False) -> tuple[dict, dict]:
    if not items:
        return {}, {}
    results, errors = {}, {}
    try:
        coins = get_json("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h")
        by_id = {f"crypto:{coin['id']}": coin for coin in coins if 1 <= (number(coin.get("market_cap_rank")) or 10000) <= 100}
        if not by_id:
            raise ValueError("CoinGecko empty top100 response")
        if not restrict and (len(by_id) != 100 or {int(coin["market_cap_rank"]) for coin in by_id.values()} != set(range(1, 101)) or
                             any(number(coin.get("current_price")) is None for coin in by_id.values())):
            raise ValueError("CoinGecko top100 response incomplete; preserving the previous complete universe")
        if not restrict:
            old = {item["id"]: item for item in items}
            items = [old.get(identifier) or {"id": identifier, "market": "crypto", "symbol": coin["symbol"].upper(),
                     "name": coin["name"], "name_en": coin["name"], "aliases": [coin["id"], coin["name"], coin["symbol"]],
                     "groups": ["top100"], "currency": "USD"} for identifier, coin in by_id.items()]
        for item in items:
            coin = by_id.get(item["id"])
            if not coin or number(coin.get("current_price")) is None:
                errors[item["id"]] = "CoinGecko 현재 시총 100 응답에서 수신하지 못했습니다."
                continue
            refreshed = {**item, "price": number(coin["current_price"]), "change_pct": number(coin.get("price_change_percentage_24h")),
                         "market_cap": number(coin.get("market_cap")), "market_cap_rank": coin.get("market_cap_rank"),
                         "updated_at": coin.get("last_updated"), "fetched_at": fetched_at, "source": "CoinGecko",
                         "price_basis": "aggregate_spot", "history": [number(value) for value in coin.get("sparkline_in_7d", {}).get("price", []) if number(value) is not None], "stale": False}
            results[item["id"]] = (refreshed, None)
    except Exception as error:
        errors.update({item["id"]: str(error)[:200] for item in items})
    return results, errors


def existing_history(item: dict, directory: Path, start: str, fetched_at: str) -> tuple[list, str, str]:
    """Refresh recent bars each run; retrieve full history at least weekly."""
    try:
        data = json.loads((directory / history_filename(item["id"])).read_text(encoding="utf-8"))
        if data.get("id") != item["id"] or data.get("price_basis") != "daily_close":
            raise ValueError("Different history contract")
        rows = [{"date": point["time"][:10], "close": point["value"]} for point in data["points"] if point["time"][:10] >= start]
        full_at = data.get("full_history_fetched_at") or data["generated_at"]
        age = datetime.fromisoformat(fetched_at.replace("Z", "+00:00")) - datetime.fromisoformat(full_at.replace("Z", "+00:00"))
        if rows and age < timedelta(days=7):
            recent = (date.fromisoformat(rows[-1]["date"]) - timedelta(days=10)).isoformat()
            return rows, max(start, recent), full_at
        if rows:
            return rows, start, fetched_at
    except (OSError, KeyError, ValueError, TypeError):
        pass
    return [], start, fetched_at


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def main(argv=None) -> int:
    started = time.monotonic()
    spec = importlib.util.spec_from_file_location("market_momentum", ROOT / "scripts/market-momentum.py")
    momentum = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(momentum)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalogue", type=Path, default=ROOT / "public/modules/board/markets.json")
    parser.add_argument("--output", type=Path, default=ROOT / "public/modules/board/markets.json")
    parser.add_argument("--history-dir", type=Path, default=ROOT / "public/modules/board/history")
    parser.add_argument("--symbols", help="Comma-separated namespaced IDs for a bounded smoke run")
    parser.add_argument("--no-history", action="store_true")
    parser.add_argument("--start", default=(date.today() - timedelta(days=370)).isoformat())
    parser.add_argument("--crypto-history-budget", type=int, default=100)
    parser.add_argument("--crypto-min-interval", type=float, default=momentum.CRYPTO_MIN_INTERVAL)
    args = parser.parse_args(argv)
    if not 0 <= args.crypto_history_budget <= 100 or args.crypto_min_interval < 2:
        parser.error("Crypto history budget must be 0..100 and min interval at least 2 seconds")
    if args.symbols and (args.output.resolve() == (ROOT / "public/modules/board/markets.json").resolve() or
                         (not args.no_history and args.history_dir.resolve() == (ROOT / "public/modules/board/history").resolve())):
        parser.error("A --symbols smoke run requires isolated --output and --history-dir (or --no-history)")
    previous = json.loads(args.catalogue.read_text(encoding="utf-8"))
    if args.symbols:
        requested = set(args.symbols.split(","))
        previous["items"] = [item for item in previous["items"] if item["id"] in requested]
        missing = requested - {item["id"] for item in previous["items"]}
        if missing:
            raise ValueError(f"Unknown IDs in catalogue: {sorted(missing)}")
    items = previous["items"]
    if not items:
        raise ValueError("No instruments selected")
    fetched_at = utc_now()
    prior_histories = {item["id"]: existing_history(item, args.history_dir, args.start, fetched_at) for item in items if item["market"] != "crypto"}
    starts = {identifier: value[1] for identifier, value in prior_histories.items()}
    raw_rows, errors = load_stock_rows(items, args.start, starts)
    results = {}
    for item in items:
        if item["id"] not in raw_rows:
            continue
        try:
            source = "FinanceDataReader (일봉)" if item["market"] == "kr" else "yfinance (일봉)"
            if not raw_rows[item["id"]]:
                raise ValueError(f"{item['id']}: recent daily rows unavailable")
            results[item["id"]] = normalize_daily(item, prior_histories[item["id"]][0] + raw_rows[item["id"]], fetched_at, source)
            results[item["id"]][1]["full_history_fetched_at"] = prior_histories[item["id"]][2]
            errors.pop(item["id"], None)
        except ValueError as error:
            errors[item["id"]] = str(error)
    crypto_items = [item for item in items if item["market"] == "crypto"]
    remaining = momentum.cooldown_seconds(previous.get("momentum_collection", {}), utc_now())
    if remaining:
        crypto_results, crypto_errors = {}, {item["id"]: f"CoinGecko cooldown active for {remaining} seconds; previous quote preserved" for item in crypto_items}
    else:
        crypto_results, crypto_errors = load_crypto(crypto_items, fetched_at, restrict=bool(args.symbols))
    results.update(crypto_results)
    errors.update(crypto_errors)
    if crypto_results and not args.symbols:
        previous["items"] = [item for item in items if item["market"] != "crypto"] + [value[0] for value in crypto_results.values()]
        items = previous["items"]
    for item in items:
        if item["id"] not in results:
            errors.setdefault(item["id"], "No usable provider data")
    if not results:
        print(json.dumps({"status": "failed", "message": "All providers failed; existing output preserved", "errors": errors}, ensure_ascii=False), file=sys.stderr)
        return 1
    if not args.no_history:
        for identifier, (_, history) in results.items():
            if history:
                atomic_json(args.history_dir / history_filename(identifier), history)
    payload = merge_snapshot(previous, results, errors, fetched_at)
    payload["collection"]["packages"] = {name: importlib.metadata.version(name) for name in ("finance-datareader", "yfinance")}
    payload = momentum.annotate_snapshot(payload, args.history_dir, utc_now(), 0 if args.no_history else args.crypto_history_budget, args.crypto_min_interval)
    atomic_json(args.output, payload)
    history_collection = payload["momentum_collection"]
    history_requested = not args.no_history and args.crypto_history_budget > 0
    partial = bool(errors or history_collection["failed"] or (history_requested and history_collection["deferred"]))
    print(json.dumps({"status": "partial" if partial else "complete", "output": str(args.output.resolve()),
                      "history_dir": str(args.history_dir.resolve()), "generated_at": fetched_at,
                      "price_collection": payload["collection"], "momentum_collection": history_collection,
                      "duration_seconds": round(time.monotonic() - started, 3)}, ensure_ascii=False))
    return 2 if partial else 0


if __name__ == "__main__":
    raise SystemExit(main())
