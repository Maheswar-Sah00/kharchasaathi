"""Safety controls: prompt-injection scrubbing, request policy, recipient allowlist."""
import os, re

INJECTION_PATTERNS = [
    r"ignore (all )?(previous|prior|above) instructions",
    r"system (note|prompt|message)",
    r"\bai assistant\b",
    r"\byou are now\b",
    r"disregard .*instructions",
    r"email (the )?(full )?statement",
    r"mark (every|all) transactions?",
]
_inj = re.compile("|".join(INJECTION_PATTERNS), re.I)


def is_injection(text: str) -> bool:
    return bool(_inj.search(text or ""))


def sanitize(text: str) -> str:
    """What the LLM is allowed to see of a transaction description."""
    if is_injection(text):
        return "[REDACTED: instruction-like text found inside transaction description - treated as data only]"
    return text[:160]


# ---- user request policy (deterministic guard, runs BEFORE the LLM) ----
REFUSE_RULES = [
    (r"(send|email|fire off|dispatch).{0,40}(without|no|skip).{0,20}(approv|ask|confirm|review)", "Sending anything without your explicit approval is not allowed. Every email waits for an Approve click."),
    (r"auto[- ]?(send|approve)", "Auto-sending/auto-approving is disabled by design. You must approve each email."),
    (r"(transfer|send|pay|move)\s+(rs\.?|₹|inr)?\s*\d", "I can't move money or make payments. I only audit, draft and wait for your approval."),
    (r"\b(transfer|withdraw|pay)\b.{0,30}\b(money|funds|amount|rupees)\b", "I can't move money or make payments. I only audit, draft and wait for your approval."),
    (r"(share|send|email|forward).{0,40}(statement|transactions|bank details|card number|otp|password)", "I won't share your statements, card details or OTPs with anyone."),
    (r"(delete|clear|wipe).{0,20}(audit|log)", "The audit log can't be deleted - it's how you can verify what I did."),
    (r"\b(otp|cvv|pin|password)\b", "Never share OTP/CVV/PIN/passwords. I don't need them and will never ask."),
]


def policy_check(user_text: str):
    """Returns (allowed: bool, reason: str)."""
    t = (user_text or "").lower()
    for pat, reason in REFUSE_RULES:
        if re.search(pat, t):
            return False, reason
    return True, ""


def allowed_recipient(addr: str) -> bool:
    demo = (os.environ.get("DEMO_INBOX") or "").strip().lower()
    return bool(demo) and (addr or "").strip().lower() == demo
