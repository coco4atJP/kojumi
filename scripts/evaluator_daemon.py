import os
import sys
import time
import requests
import json
import csv
import io
import re
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add the local sdk to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../sdks/python')))
from kojumi_eval_sdk import KojumiEvalClient, CanonicalFeatures

API_URL = os.getenv("KOJUMI_API_URL", "http://localhost:8080")
SECRET_KEY = os.getenv("KOJUMI_EVAL_SECRET")
if not SECRET_KEY:
    raise RuntimeError("KOJUMI_EVAL_SECRET environment variable is required.")
API_KEY = os.getenv("KOJUMI_API_KEY", "")
GDPVAL_DATASET = os.getenv("GDPVAL_DATASET", "openai/gdpval")
GDPVAL_SPLIT = os.getenv("GDPVAL_SPLIT", "train")
GDPVAL_ROWS_URL = os.getenv("GDPVAL_ROWS_URL", "https://datasets-server.huggingface.co/rows")
GDPVAL_CASE_CACHE = {}

def model_env_prefix(model):
    return model.upper().replace('-', '_').replace('/', '_').replace(':', '_').replace('.', '_')

def model_provider(model):
    return str(model or "").split("/", 1)[0].strip().lower()

def env_for_model(model, name, default=None):
    model_specific = os.getenv(f"{name}_{model_env_prefix(model)}")
    if model_specific not in (None, ""):
        return model_specific

    provider = model_provider(model)
    provider_prefix = provider.upper().replace('-', '_').replace('.', '_')
    provider_specific = os.getenv(f"{name}_{provider_prefix}")
    if provider_specific not in (None, ""):
        return provider_specific

    if name == "EVAL_API_KEY":
        if provider == "openrouter":
            return os.getenv("OPENROUTER_API_KEY", default)
        if provider == "groq":
            return os.getenv("GROQ_API_KEY", default)
        if provider in ("nvidia_nim", "nvidia"):
            return os.getenv("NVIDIA_NIM_API_KEY") or os.getenv("NVIDIA_API_KEY") or default
        if provider == "openai" and str(model).startswith("openai/local-"):
            return os.getenv(name, default)
        return default

    if name == "EVAL_API_BASE":
        if provider == "openrouter":
            return os.getenv("OPENROUTER_API_BASE", default)
        if provider == "groq":
            return os.getenv("GROQ_API_BASE", default)
        if provider in ("nvidia_nim", "nvidia"):
            return os.getenv("NVIDIA_NIM_API_BASE") or os.getenv("NVIDIA_API_BASE") or default

    return os.getenv(name, default)

def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")

def env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default

def env_float(name, default):
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default

def retry_without_reasoning_param(error):
    message = str(error).lower()
    return any(token in message for token in (
        "reasoning_effort",
        "unsupported parameter",
        "unknown parameter",
        "unexpected keyword",
        "unrecognized request argument",
    ))

def retry_without_response_format_param(error):
    message = str(error).lower()
    return any(token in message for token in (
        "response_format",
        "unsupported parameter",
        "unknown parameter",
        "unexpected keyword",
        "unrecognized request argument",
    ))

def compact_text(value, max_chars):
    text = str(value or "").strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text

    head_chars = max(1, int(max_chars * 0.65))
    tail_chars = max(1, max_chars - head_chars)
    omitted = len(text) - max_chars
    return f"{text[:head_chars]}\n...[truncated {omitted} chars]...\n{text[-tail_chars:]}"

def strip_json_response(text):
    cleaned = str(text or "").strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL | re.IGNORECASE).strip()
    marker = "FINAL_JSON:"
    marker_index = cleaned.rfind(marker)
    if marker_index != -1:
        cleaned = cleaned[marker_index + len(marker):].strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:].strip()
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:].strip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].strip()

    start = cleaned.rfind("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start:end + 1]
    return json.loads(cleaned)

def is_gdpval_metadata(task_metadata):
    suite = str(task_metadata.get("benchmark_suite") or task_metadata.get("benchmarkSuite") or "").lower()
    return suite in ("gdp val", "gdpval")

def extract_gdpval_task_id(delivery):
    brief = delivery.get("contract", {}).get("brief") or ""
    for line in brief.splitlines():
        if line.startswith("Task ID:"):
            return line.split(":", 1)[1].strip()
    return None

def fetch_gdpval_case_by_task_id(task_id):
    if not task_id:
        return None
    if task_id in GDPVAL_CASE_CACHE:
        return GDPVAL_CASE_CACHE[task_id]

    # The public GDPval gold set has 220 rows. Fetching in chunks keeps this
    # independent of optional parquet/pandas dependencies.
    for offset in range(0, 220, 100):
        response = requests.get(
            GDPVAL_ROWS_URL,
            params={
                "dataset": GDPVAL_DATASET,
                "split": GDPVAL_SPLIT,
                "offset": offset,
                "length": 100,
            },
            timeout=30,
        )
        response.raise_for_status()
        for item in response.json().get("rows", []):
            row = item.get("row", {})
            if row.get("task_id") == task_id:
                GDPVAL_CASE_CACHE[task_id] = row
                return row
    return None

def infer_evaluation_tier(task_metadata, delivery=None):
    explicit = str(
        task_metadata.get("evaluation_tier")
        or task_metadata.get("evaluationTier")
        or task_metadata.get("evaluation_routing_tier")
        or task_metadata.get("evaluationRoutingTier")
        or task_metadata.get("tier")
        or ""
    ).strip().lower()
    if explicit in ("light", "standard", "high", "frontier"):
        return explicit

    benchmark = (delivery or {}).get("contract", {}).get("benchmark", {}) or {}
    difficulty = str(benchmark.get("difficulty") or task_metadata.get("difficulty") or "").lower()
    criteria_text = json.dumps(task_metadata.get("evaluation_strategy", {}), ensure_ascii=False)

    if is_gdpval_metadata(task_metadata):
        return "frontier"
    if difficulty in ("hard", "very_hard", "expert", "frontier"):
        return "high"
    if len(criteria_text) > env_int("EVAL_HIGH_TIER_CRITERIA_CHARS", 2500):
        return "high"
    return "standard"

def eval_models_for_tier(tier):
    if tier == "frontier":
        return os.getenv("EVAL_FRONTIER_MODEL", os.getenv("EVAL_HIGH_MODEL", os.getenv("EVAL_MODEL", "")))
    if tier == "high":
        return os.getenv("EVAL_HIGH_MODEL", os.getenv("EVAL_MODEL", ""))
    return os.getenv("EVAL_MODEL", "")

class HybridEvaluator:
    _last_llm_call_times = {}

    @classmethod
    def _run_llm_judge(cls, current_model, messages):
        import litellm
        litellm.suppress_debug_info = True

        env_prefix = model_env_prefix(current_model)
        api_base = env_for_model(current_model, "EVAL_API_BASE")
        api_key = env_for_model(current_model, "EVAL_API_KEY")
        reasoning_effort = env_for_model(current_model, "EVAL_REASONING_EFFORT", "low").strip()
        temperature = env_for_model(current_model, "EVAL_TEMPERATURE")
        max_tokens = env_int(f"EVAL_MAX_OUTPUT_TOKENS_{env_prefix}", env_int("EVAL_MAX_OUTPUT_TOKENS", 1000))
        timeout = env_float(f"EVAL_REQUEST_TIMEOUT_{env_prefix}", env_float("EVAL_REQUEST_TIMEOUT", 180.0))

        kwargs = {
            "model": current_model,
            "messages": messages,
            "max_tokens": max_tokens,
            "timeout": timeout,
        }
        if api_base:
            kwargs["api_base"] = api_base
        if api_key:
            kwargs["api_key"] = api_key
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        if temperature not in (None, ""):
            kwargs["temperature"] = float(temperature)
        elif not reasoning_effort:
            kwargs["temperature"] = 0.0
        if env_bool("EVAL_RESPONSE_FORMAT_JSON", False):
            kwargs["response_format"] = {"type": "json_object"}

        api_identifier = f"{api_base or 'default'}-{current_model}"
        rate_limit_delay = env_float(f"EVAL_RATE_LIMIT_DELAY_{env_prefix}", env_float("EVAL_RATE_LIMIT_DELAY", 2.0))
        last_call_time = cls._last_llm_call_times.get(api_identifier, 0.0)
        elapsed = time.time() - last_call_time
        if elapsed < rate_limit_delay:
            time.sleep(rate_limit_delay - elapsed)
        cls._last_llm_call_times[api_identifier] = time.time()

        try:
            response = litellm.completion(**kwargs)
        except Exception as e:
            if (
                reasoning_effort
                and env_bool("EVAL_RETRY_WITHOUT_REASONING_PARAM", True)
                and retry_without_reasoning_param(e)
            ):
                retry_kwargs = dict(kwargs)
                retry_kwargs.pop("reasoning_effort", None)
                response = litellm.completion(**retry_kwargs)
            elif (
                kwargs.get("response_format")
                and env_bool("EVAL_RETRY_WITHOUT_RESPONSE_FORMAT", True)
                and retry_without_response_format_param(e)
            ):
                retry_kwargs = dict(kwargs)
                retry_kwargs.pop("response_format", None)
                response = litellm.completion(**retry_kwargs)
            else:
                raise
        return response.choices[0].message.content.strip()

    @classmethod
    def _judge_with_fallbacks(cls, eval_models_str, messages, label):
        result_text = None
        used_model = None
        last_error = None

        for current_model in [m.strip() for m in eval_models_str.split(",") if m.strip()]:
            try:
                result_text = cls._run_llm_judge(current_model, messages)
                used_model = current_model
                try:
                    result_json = strip_json_response(result_text)
                except Exception:
                    print(f"       ⚠️ {label} returned non-JSON for {current_model}. Trying JSON finalizer...")
                    finalizer_messages = [
                        {
                            "role": "system",
                            "content": (
                                "Extract the final evaluator result. Return only this JSON object: "
                                "{\"score\": number, \"reasoning\": string}. "
                                "Use the final judgment if the source includes thinking or draft text."
                            )
                        },
                        {
                            "role": "user",
                            "content": compact_text(result_text, env_int("EVAL_FINALIZER_MAX_CHARS", 3000))
                        }
                    ]
                    result_text = cls._run_llm_judge(current_model, finalizer_messages)
                    result_json = strip_json_response(result_text)
                score = max(0.0, min(1.0, float(result_json.get("score", 0.0))))
                return score, str(result_json.get("reasoning", "")), used_model
            except Exception as e:
                print(f"       ⚠️ {label} API failed for {current_model} ({type(e).__name__}: {str(e)[:240]}). Trying next fallback...")
                last_error = e

        raise Exception(f"All configured evaluation models failed. Last error: {last_error}")

    @classmethod
    def evaluate_multi_check(cls, eval_models_str, criteria_text, submission, tier):
        checks = [
            ("correctness", "Does the submission satisfy the core factual and task requirements?"),
            ("completeness", "Does it cover all required parts without important omissions?"),
            ("format", "Does it match the expected format and remain usable?"),
            ("risk", "Does it contain serious errors, unsafe claims, unsupported assertions, or contradictions? Use 1.0 for high risk and 0.0 for no risk."),
        ]
        check_scores = {}
        rationales = []
        for name, question in checks:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "You are one focused benchmark checker. Use the chat template normally and reason if needed. "
                        "The final answer must contain no explanatory prose. End with exactly:\n"
                        "FINAL_JSON:\n{\"score\": 0.0, \"reasoning\": \"<=120 chars\"}"
                    )
                },
                {
                    "role": "user",
                    "content": (
                        f"Check: {name}\n"
                        f"Question: {question}\n"
                        "Score is 0.0 to 1.0.\n\n"
                        f"Criteria:\n{criteria_text}\n\n"
                        f"Submission:\n{submission}"
                    )
                }
            ]
            score, reasoning, used_model = cls._judge_with_fallbacks(eval_models_str, messages, f"{tier}:{name}")
            check_scores[name] = score
            rationales.append(f"{name}={score:.2f}:{reasoning}")
            print(f"       🧩 {tier} check {name} ({used_model}): {score:.2f} '{reasoning}'")

        quality = (
            check_scores["correctness"] * 0.45
            + check_scores["completeness"] * 0.25
            + check_scores["format"] * 0.15
            + (1.0 - check_scores["risk"]) * 0.15
        )
        return max(0.0, min(1.0, quality)), "; ".join(rationales)

    @classmethod
    def evaluate(cls, task_metadata, downloaded_data, delivery=None):
        strategy = task_metadata.get("evaluation_strategy", {})
        strategy_type = strategy.get("type", "unknown")
        tier = infer_evaluation_tier(task_metadata, delivery)
        
        metrics = {
            "accuracy": 0.0,
            "completed": downloaded_data.get("completed", False),
            "accepted": False
        }
        
        if is_gdpval_metadata(task_metadata):
            metrics["accuracy"] = cls.evaluate_gdpval(task_metadata, downloaded_data, delivery)

        elif strategy_type == "rule_based":
            rules = strategy.get("rules", [])
            passed_rules = 0
            
            for rule in rules:
                field = rule.get("field")
                if field in downloaded_data:
                    passed = True
                    if "type" in rule:
                        expected_type = rule["type"]
                        val = downloaded_data[field]
                        if expected_type == "array" and not isinstance(val, list): passed = False
                        if expected_type == "boolean" and not isinstance(val, bool): passed = False
                    
                    if "min_length" in rule:
                        if len(downloaded_data[field]) < rule["min_length"]: passed = False
                        
                    if passed:
                        passed_rules += 1
                        
            if len(rules) > 0:
                metrics["accuracy"] = passed_rules / len(rules)
            else:
                metrics["accuracy"] = 1.0
                
        elif strategy_type == "llm_judge":
            criteria = strategy.get("criteria", "")
            eval_models_str = eval_models_for_tier(tier)
            
            if eval_models_str:
                try:
                    submission = compact_text(downloaded_data.get("text_output", ""), env_int("EVAL_SUBMISSION_MAX_CHARS", 8000))
                    criteria_text = compact_text(criteria, env_int("EVAL_CRITERIA_MAX_CHARS", 2500))
                    if tier in ("high", "frontier") and env_bool("EVAL_MULTI_CHECK", True):
                        score, reasoning = cls.evaluate_multi_check(eval_models_str, criteria_text, submission, tier)
                        used_model = eval_models_str
                    else:
                        messages = [
                            {
                                "role": "system",
                                "content": (
                                    "You are a strict benchmark evaluator. Use the chat template normally and reason if needed. "
                                    "The final answer must contain no explanatory prose. End with exactly:\n"
                                    "FINAL_JSON:\n{\"score\": 0.0, \"reasoning\": \"<=160 chars\"}"
                                )
                            },
                            {
                                "role": "user",
                                "content": (
                                    "Grade the submission strictly against the criteria.\n"
                                    "Final output format must be exactly FINAL_JSON followed by one JSON object.\n"
                                    "Score is a float from 0.0 to 1.0.\n\n"
                                    f"Criteria:\n{criteria_text}\n\n"
                                    f"Submission:\n{submission}"
                                )
                            }
                        ]
                        score, reasoning, used_model = cls._judge_with_fallbacks(eval_models_str, messages, f"{tier} LLM Judge")
                    metrics["accuracy"] = score
                    print(f"       🧠 {tier} LLM Judge ({used_model}): '{reasoning}' -> Score: {metrics['accuracy']:.2f}")
                    
                except Exception as e:
                    print(f"       ⚠️ LLM Judge evaluation failed ({e}). Falling back to heuristic.")
                    text_content = downloaded_data.get("text_output", "")
                    metrics["accuracy"] = min(0.95, 0.6 + (len(text_content) / 2000)) if len(text_content) > 100 else 0.3
            else:
                text_content = downloaded_data.get("text_output", "")
                metrics["accuracy"] = min(0.95, 0.6 + (len(text_content) / 2000)) if len(text_content) > 100 else 0.3
                print(f"       🧠 Simulated Judge (No EVAL_MODEL set) -> Score: {metrics['accuracy']:.2f}")
        else:
            metrics["accuracy"] = downloaded_data.get("accuracy", 0.5)

        metrics["accepted"] = metrics["accuracy"] >= 0.6
        return metrics

    @classmethod
    def evaluate_gdpval(cls, task_metadata, downloaded_data, delivery=None):
        task_id = extract_gdpval_task_id(delivery or {})
        gdpval_case = None
        try:
            gdpval_case = fetch_gdpval_case_by_task_id(task_id)
        except Exception as e:
            print(f"       ⚠️ GDP Val case lookup failed ({e}).")

        submission = downloaded_data.get("text_output", "")
        if not submission or len(submission.strip()) < 100:
            return 0.2

        tier = infer_evaluation_tier(task_metadata, delivery)
        eval_models_str = os.getenv("EVAL_GDPVAL_MODEL", eval_models_for_tier(tier))
        if not eval_models_str:
            rubric_bonus = 0.1 if gdpval_case and gdpval_case.get("rubric_pretty") else 0.0
            reference_bonus = 0.1 if any(token in submission.lower() for token in ["source", "reference", "appendix", "calculation", "rationale"]) else 0.0
            score = min(0.85, 0.45 + len(submission) / 5000 + rubric_bonus + reference_bonus)
            print(f"       📊 Simulated GDP Val grader (No EVAL_MODEL set) -> Score: {score:.2f}")
            return score

        rubric = (gdpval_case or {}).get("rubric_pretty") or (gdpval_case or {}).get("rubric_json") or json.dumps(task_metadata.get("evaluation_criteria", {}))
        task_prompt = (gdpval_case or {}).get("prompt", delivery.get("contract", {}).get("brief", "") if delivery else "")
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a professional blind reviewer for GDP Val work products. "
                    "Use the chat template normally and reason if needed. "
                    "The final answer must contain no explanatory prose. End with exactly:\n"
                    "FINAL_JSON:\n{\"score\": 0.0, \"reasoning\": \"<=200 chars\"}"
                )
            },
            {
                "role": "user",
                "content": (
                    "Grade accuracy, completeness, format quality, and support from the provided context.\n"
                    "Final output format must be exactly FINAL_JSON followed by one JSON object.\n"
                    "Score is a float from 0.0 to 1.0.\n\n"
                    f"Task ID: {task_id or 'unknown'}\n"
                    f"Sector: {(gdpval_case or {}).get('sector', 'unknown')}\n"
                    f"Occupation: {(gdpval_case or {}).get('occupation', 'unknown')}\n\n"
                    f"Task prompt:\n{compact_text(task_prompt, env_int('EVAL_GDPVAL_PROMPT_MAX_CHARS', 5000))}\n\n"
                    f"Rubric:\n{compact_text(rubric, env_int('EVAL_GDPVAL_RUBRIC_MAX_CHARS', 6000))}\n\n"
                    f"Submitted deliverable:\n{compact_text(submission, env_int('EVAL_GDPVAL_SUBMISSION_MAX_CHARS', 12000))}"
                )
            }
        ]

        try:
            if env_bool("EVAL_MULTI_CHECK", True):
                combined = compact_text(
                    f"Task prompt:\n{task_prompt}\n\nRubric:\n{rubric}",
                    env_int("EVAL_GDPVAL_CRITERIA_MAX_CHARS", 7000)
                )
                score, reasoning = cls.evaluate_multi_check(
                    eval_models_str,
                    combined,
                    compact_text(submission, env_int("EVAL_GDPVAL_SUBMISSION_MAX_CHARS", 12000)),
                    tier,
                )
                used_model = eval_models_str
            else:
                score, reasoning, used_model = cls._judge_with_fallbacks(eval_models_str, messages, "GDP Val grader")
            print(f"       📊 GDP Val grader ({used_model}): '{reasoning}' -> Score: {score:.2f}")
            return score
        except Exception as e:
            print(f"       ⚠️ GDP Val grading failed. Last error: {e}")
        return 0.3

def get_headers():
    return {"x-api-key": API_KEY} if API_KEY else {}

def parse_delivery_artifact(task_metadata, response):
    expected_format = str(task_metadata.get("expected_output_format") or "").lower()
    content_type = response.headers.get("content-type", "").lower()
    raw_text = response.text

    normalized = {
        "completed": True,
        "text_output": raw_text
    }

    expects_json = "json" in expected_format or "application/json" in content_type
    expects_csv = "csv" in expected_format or "text/csv" in content_type

    if expects_json:
        parsed_json = response.json()
        if isinstance(parsed_json, dict):
            normalized.update(parsed_json)
            normalized.setdefault("text_output", json.dumps(parsed_json, ensure_ascii=False, indent=2))
        else:
            normalized["json_output"] = parsed_json
            normalized["items"] = parsed_json if isinstance(parsed_json, list) else [parsed_json]
            normalized["text_output"] = json.dumps(parsed_json, ensure_ascii=False, indent=2)
        return normalized

    if expects_csv:
        reader = csv.DictReader(io.StringIO(raw_text))
        normalized["rows"] = list(reader)
        return normalized

    if "markdown" in expected_format or "bibtex" in expected_format or "text" in expected_format:
        return normalized

    if "application/json" in content_type:
        parsed_json = response.json()
        if isinstance(parsed_json, dict):
            normalized.update(parsed_json)
        else:
            normalized["json_output"] = parsed_json
        normalized["text_output"] = json.dumps(parsed_json, ensure_ascii=False, indent=2)

    return normalized

def run_daemon():
    print("🚀 Starting Kojumi Official Evaluator Daemon...")
    client = KojumiEvalClient(api_url=API_URL, signing_secret=SECRET_KEY, api_key=API_KEY)

    while True:
        try:
            # 1. Fetch un-evaluated deliveries (status: submitted)
            res = requests.get(f"{API_URL}/v1/deliveries?status=submitted", headers=get_headers())
            res.raise_for_status()
            deliveries = res.json().get("items", [])

            for delivery in deliveries:
                delivery_id = delivery["id"]
                contract_id = delivery["contractId"]
                output_uri = delivery["outputUri"]
                
                print(f"\nEvaluating Delivery: {delivery_id}")

                benchmark = delivery.get("contract", {}).get("benchmark", {})
                if not benchmark:
                    print(f"⚠️ Not an official benchmark task delivery, skipping.")
                    continue

                task_metadata = json.loads(benchmark.get("metadataJson") or "{}")

                # 2. Download result
                if output_uri.startswith("local://"):
                    download_url = f"{API_URL}/v1/deliveries/{delivery_id}/file"
                    try:
                        download_res = requests.get(download_url, headers=get_headers())
                        download_res.raise_for_status()
                        downloaded_data = parse_delivery_artifact(task_metadata, download_res)
                    except Exception as e:
                        print(f"❌ Failed to download file from {download_url}: {e}")
                        continue
                else:
                    print(f"⚠️ Unsupported URI: {output_uri}")
                    continue

                # 3. Evaluate
                evaluation_result = HybridEvaluator.evaluate(task_metadata, downloaded_data, delivery)
                
                features = CanonicalFeatures(
                    f_completed=evaluation_result.get("completed", False),
                    f_accepted=evaluation_result.get("accepted", False),
                    f_duration_ms=downloaded_data.get("metadata", {}).get("duration_ms", 10000),
                    f_success_cost=downloaded_data.get("metadata", {}).get("success_cost", 0.5),
                    f_tool_calls=downloaded_data.get("metadata", {}).get("tool_calls", 10),
                    f_approval_requests=downloaded_data.get("metadata", {}).get("approval_requests", 0),
                    f_subagent_delegations=downloaded_data.get("metadata", {}).get("subagent_delegations", 0),
                    f_benchmark_score=evaluation_result.get("accuracy", 0.0)
                )

                # 4. Submit Evaluation
                eval_res = client.submit_evaluation(
                    contract_id=contract_id,
                    delivery_id=delivery_id,
                    features=features
                )
                print(f"✅ Evaluation Submitted! Score: {eval_res.get('totalScore', 0):.2f}")

                # 5. Update delivery status
                if features.f_accepted:
                    requests.post(f"{API_URL}/v1/deliveries/{delivery_id}/accept", headers=get_headers()).raise_for_status()
                    print(f"📦 Delivery {delivery_id} Accepted.")
                else:
                    requests.post(f"{API_URL}/v1/deliveries/{delivery_id}/reject", headers=get_headers()).raise_for_status()
                    print(f"📦 Delivery {delivery_id} Rejected.")

                # 6. Delete delivery file to save capacity
                try:
                    del_res = requests.delete(f"{API_URL}/v1/deliveries/{delivery_id}", headers=get_headers())
                    del_res.raise_for_status()
                    print(f"🗑️  Deleted output file for Delivery {delivery_id} to save capacity.")
                except Exception as e:
                    print(f"⚠️ Failed to delete output file for Delivery {delivery_id}: {e}")

        except Exception as e:
            print(f"❌ Evaluator Daemon Error: {e}")

        # Wait before next poll
        time.sleep(10)

if __name__ == "__main__":
    run_daemon()
