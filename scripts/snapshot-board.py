"""스윙전광판 파이프라인을 한 번 돌려 data.json 을 만든다."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "스윙전광판" / "backend"
if not BACKEND.is_dir():
    raise SystemExit(f"backend not found: {BACKEND}")

sys.path.insert(0, str(BACKEND))

from app.db.session import init_db
from app.pipeline import recompute_board


async def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/modules/board/data.json")
    init_db()
    snap = await recompute_board()
    payload = snap.to_response()
    payload["details"] = {
        s.symbol: {
            "symbol": s.symbol,
            "display": s.display,
            "calculated_at": payload["generated_at"],
            "candle_closed": s.candle_closed,
            "score": s.score,
            "score_long": s.score_long,
            "score_short": s.score_short,
            "direction": s.direction,
            "band": s.band,
            "regime_multiplier_long": snap.regime.multiplier_long,
            "regime_multiplier_short": snap.regime.multiplier_short,
            "degraded": s.degraded,
            "components": [c.to_dict() for c in s.components],
        }
        for s in snap.scores
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out} items={len(payload['items'])} generated_at={payload['generated_at']}")


if __name__ == "__main__":
    asyncio.run(main())
