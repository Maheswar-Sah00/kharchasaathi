"""Thin Claude wrapper (Anthropic SDK). Server-side refusal fallback enabled when supported."""
import json, os
import anthropic
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"))

MODEL = os.environ.get("LLM_MODEL", "claude-opus-5-5")
_client = None
_fallback_ok = True
CALLS = {"n": 0, "in": 0, "out": 0}


def client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=3)
    return _client


def create(**kw):
    """messages.create with refusal fallbacks; transparently retries without them if rejected."""
    global _fallback_ok
    kw.setdefault("model", MODEL)
    if _fallback_ok:
        try:
            r = client().beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
            _track(r)
            return r
        except anthropic.BadRequestError as e:
            if "fallback" not in str(e).lower():
                raise
            _fallback_ok = False
    r = client().messages.create(**kw)
    _track(r)
    return r


def _track(r):
    CALLS["n"] += 1
    try:
        CALLS["in"] += r.usage.input_tokens
        CALLS["out"] += r.usage.output_tokens
    except Exception:
        pass


def text_of(r):
    return "".join(b.text for b in r.content if getattr(b, "type", "") == "text")


def json_call(system, user, schema, effort="low", max_tokens=8000):
    """Single structured-output call. Returns parsed JSON."""
    r = create(max_tokens=max_tokens, system=system,
               messages=[{"role": "user", "content": user}],
               output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}})
    if r.stop_reason == "refusal":
        raise RuntimeError("Model declined the request")
    return json.loads(text_of(r))
