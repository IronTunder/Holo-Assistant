import asyncio
import json
import sys
from pathlib import Path
from statistics import mean
from time import perf_counter

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app import models  # noqa: F401
from app.core.database import SessionLocal
from app.services.knowledge_retrieval import knowledge_retrieval_service

DEFAULT_DATASET = ROOT_DIR / "tests" / "golden_questions.sample.json"


async def benchmark(dataset_path: Path) -> int:
    cases = json.loads(dataset_path.read_text(encoding="utf-8"))
    db = SessionLocal()
    latencies_ms: list[float] = []
    correct = 0

    try:
        for case in cases:
            started_at = perf_counter()
            result = await knowledge_retrieval_service.resolve_question(
                db,
                machine_id=case["machine_id"],
                question=case["question"],
            )
            latency_ms = round((perf_counter() - started_at) * 1000, 2)
            latencies_ms.append(latency_ms)

            actual_id = result.response_payload.get("knowledge_item_id") if result.response_payload else None
            expected_id = case.get("expected_knowledge_item_id")
            expected_mode = case.get("expected_mode")
            is_correct = actual_id == expected_id
            if expected_mode is not None:
                is_correct = is_correct and result.mode == expected_mode
            correct += int(is_correct)

            print(
                json.dumps(
                    {
                        "question": case["question"],
                        "mode": result.mode,
                        "route": result.route,
                        "confidence": result.confidence,
                        "expected_knowledge_item_id": expected_id,
                        "expected_mode": expected_mode,
                        "actual_knowledge_item_id": actual_id,
                        "actual_mode": result.mode,
                        "reason_code": result.reason_code,
                        "latency_ms": latency_ms,
                        "correct": is_correct,
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        db.close()

    accuracy = (correct / len(cases)) * 100 if cases else 0.0
    p95_index = max(int(len(latencies_ms) * 0.95) - 1, 0)
    sorted_latencies = sorted(latencies_ms)
    p95_latency = sorted_latencies[p95_index] if sorted_latencies else 0.0

    print("\n=== Benchmark Summary ===")
    print(f"dataset: {dataset_path}")
    print(f"cases: {len(cases)}")
    print(f"accuracy_top1: {accuracy:.2f}%")
    print(f"latency_avg_ms: {mean(latencies_ms) if latencies_ms else 0.0:.2f}")
    print(f"latency_p95_ms: {p95_latency:.2f}")
    return 0


def main() -> int:
    dataset_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_DATASET
    if not dataset_path.exists():
        print(f"Dataset non trovato: {dataset_path}", file=sys.stderr)
        return 1
    return asyncio.run(benchmark(dataset_path))


if __name__ == "__main__":
    raise SystemExit(main())
