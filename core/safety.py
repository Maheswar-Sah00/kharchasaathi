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
    (r"\b(otp|cvv|pin|password)\b\W{0,4}(is\W{0,3})?\d{3,}|\bmy (otp|cvv|pin|password)\b|\b(otp|cvv|pin)\s*[:=]",
     "Never share OTP/CVV/PIN/passwords. I don't need them and will never ask."),
    (r"^\s*(please\s+)?(pay|transfer|send money|move money|recharge)\b|\b(can|could|would) you\s+(please\s+)?(pay|transfer|recharge)\b|"
     r"\bpay (my|the|for)\b.{0,25}\b(now|today|for me)\b",
     "I can't move money or make payments. I only audit, draft and wait for your approval."),
]
# rules that only apply to requests to ACT (indices into REFUSE_RULES). Questions about past data are fine,
# e.g. "Did I pay any money to Ramesh?" or "Did you send the Netflix email without my approval?"
_ACTION_ONLY = {0, 1, 2, 3, 6}
_QUESTION = re.compile(r"^\s*(how|what|which|when|did|do i|does|was|were|is there|are there|show|list|why|where|"
                       r"tell me|give me|summari[sz]e|compare|explain|find)\b", re.I)
_REQUEST = re.compile(r"\b(can you|could you|please|for me|go ahead|now)\b.{0,40}\b(transfer|pay|send|move|approve)\b", re.I)


def is_question(text: str) -> bool:
    return bool(_QUESTION.search(text or "")) and not _REQUEST.search(text or "")


def policy_check(user_text: str, conversational: bool = False):
    """Returns (allowed: bool, reason: str). conversational=True (chat) lets informational questions through the
    money-movement / approval rules; sharing data, secrets and deleting the audit log are always refused."""
    t = (user_text or "").lower()
    q = conversational and is_question(t)
    reasons = []
    for i, (pat, reason) in enumerate(REFUSE_RULES):
        if q and i in _ACTION_ONLY:
            continue
        if re.search(pat, t) and reason not in reasons:
            reasons.append(reason)
    return (False, " ".join(reasons)) if reasons else (True, "")


def allowed_recipient(addr: str) -> bool:
    demo = (os.environ.get("DEMO_INBOX") or "").strip().lower()
    return bool(demo) and (addr or "").strip().lower() == demo
