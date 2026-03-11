# FILE: /backend/financial_utils.py
"""
Helper functions for the financial system.
UPDATED: Comprehensive subject code recognition + better library name parsing.

KEY RULES:
  - Strip "(OLD)", "(0LD)", "[OLD]" etc. prefixes completely before parsing
  - Recognize ALL subject variants: ISC, BIO, CH/CHEM, PHYS, MATH (including PURE-MATH, APPLIED-MATH)
  - Common subjects (AR, EN, HX, SS, S.S, HIST, GEO, SOC) appear in ALL sections
  - Section subjects are specific to GEN (AR-taught) or LANG (EN-taught)
  - Handle multi-part subject codes like "PURE-MATH", "APPLIED-MATH"
"""

import re
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Common subjects - appear in BOTH GEN and LANG sections
# When these appear immediately after stage code, they ARE the subject (no section indicator)
COMMON_SUBJECT_CODES = {
    'AR', 'EN', 'HX', 'SS', 'S.S', 'HIST', 'HISTORY',
    'GEO', 'GEOGRAPHY', 'SOC', 'SOCIAL'
}

# Section-specific subject codes - need section indicator (AR=GEN, EN=LANG)
SECTION_SUBJECT_CODES = {
    'ISC', 'BIO', 'BIOLOGY',
    'CH', 'CHEM', 'CHEMISTRY',
    'PHYS', 'PHYSICS',
    'MATH', 'MATHEMATICS',
    'PURE', 'APPLIED',  # for PURE-MATH, APPLIED-MATH
}

# Section indicators (appear AFTER subject code)
SECTION_INDICATOR_TO_SECTION = {
    'AR': 'GEN',   # Arabic-taught → General Section
    'EN': 'LANG',  # English-taught → Language Section
}

# Subject code normalization (handle variants)
SUBJECT_CODE_ALIASES = {
    'CHEM': 'CH',
    'CHEMISTRY': 'CH',
    'BIOLOGY': 'BIO',
    'PHYSICS': 'PHYS',
    'MATHEMATICS': 'MATH',
    'HISTORY': 'HX',
    'HIST': 'HX',
    'GEOGRAPHY': 'GEO',
    'SOCIAL': 'SOC',
    'S.S': 'SS',
}


def normalize_subject_code(code: str) -> str:
    """Normalize subject code to canonical form."""
    code = code.upper().strip()
    return SUBJECT_CODE_ALIASES.get(code, code)


def parse_library_name(library_name: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
    """
    Parse a Bunny library name into
    (stage_code, section_code, subject_code, teacher_code, teacher_name).

    Returns:
        - section_code is None for common subjects (they belong to ALL sections)
        - section_code is 'GEN' or 'LANG' for section-specific subjects
        - teacher_code is the P-number e.g. 'P0046', or None if not found
        - teacher_name is everything after the P-number, or None if not found

    Examples:
        "(OLD)S1-AR-P0046-Zakaria Seif Eldin"  -> ('S1', None,  'AR',  'P0046', 'Zakaria Seif Eldin')
        "S1-ISC-AR-P0022-Mohamed Ali"          -> ('S1', 'GEN', 'ISC', 'P0022', 'Mohamed Ali')
        "S1-MATH-EN-P0138-Menna Ahmed"         -> ('S1', 'LANG','MATH','P0138', 'Menna Ahmed')
        "S1-AR-General"                        -> ('S1', None,  'AR',   None,    None)
    """
    try:
        if not library_name:
            return (None, None, None, None, None)

        name = library_name.strip()

        # Strip leading qualifiers: (OLD), (0LD), [OLD], etc.
        name = re.sub(r'^\s*[\(\[][^\)\]]*[\)\]]\s*', '', name)
        name = re.sub(r'^\s*OLD\s*', '', name, flags=re.IGNORECASE)

        # ── Extract teacher code (P followed by exactly 4 digits) ────────────
        # Search the stripped name before splitting, preserving the
        # text after the P-code as the teacher name.
        teacher_code = None
        teacher_name = None
        p_match = re.search(r'[Pp](\d{4})', name)
        if p_match:
            teacher_code = f"P{p_match.group(1)}"
            # Everything after "P0046-" or "P0046 " is the teacher name
            after_p = name[p_match.end():]
            # Strip leading separator characters (hyphens, spaces)
            after_p = re.sub(r'^[\s\-]+', '', after_p).strip()
            if after_p:
                teacher_name = after_p

        # Split on hyphens (one or more) for stage/subject/section parsing
        parts = [p.strip().upper() for p in re.split(r'-+', name) if p.strip()]

        if len(parts) < 2:
            logger.warning(f"Too few parts to parse '{library_name}': {parts}")
            return (None, None, None, teacher_code, teacher_name)

        # ── STAGE (always first part: letter + digit(s)) ──────────────────────
        first = parts[0]
        if not re.match(r'^[A-Z]\d+$', first):
            logger.warning(f"First part '{first}' not a stage code in '{library_name}'")
            return (None, None, None, teacher_code, teacher_name)
        stage_code = first

        # ── SUBJECT & SECTION ─────────────────────────────────────────────────
        part1 = parts[1]
        normalized_part1 = normalize_subject_code(part1)

        if normalized_part1 in COMMON_SUBJECT_CODES:
            subject_code = normalized_part1
            section_code = None
            logger.debug(f"'{library_name}' -> common: stage={stage_code}, subject={subject_code}, teacher={teacher_code}")
            return (stage_code, section_code, subject_code, teacher_code, teacher_name)

        # Check for multi-part subject codes (PURE-MATH, APPLIED-MATH)
        if len(parts) >= 3 and part1 in ('PURE', 'APPLIED') and parts[2] == 'MATH':
            subject_code = f"{part1}-MATH"
            section_code = None
            if len(parts) >= 4 and parts[3] in SECTION_INDICATOR_TO_SECTION:
                section_code = SECTION_INDICATOR_TO_SECTION[parts[3]]
            logger.debug(f"'{library_name}' -> multi-part: stage={stage_code}, section={section_code}, subject={subject_code}, teacher={teacher_code}")
            return (stage_code, section_code, subject_code, teacher_code, teacher_name)

        # Single-part section subject (ISC, BIO, CH, PHYS, MATH, etc.)
        if normalized_part1 in SECTION_SUBJECT_CODES or part1 in SECTION_SUBJECT_CODES:
            subject_code = normalized_part1 if normalized_part1 in SECTION_SUBJECT_CODES else part1
            section_code = None
            if len(parts) >= 3 and parts[2] in SECTION_INDICATOR_TO_SECTION:
                section_code = SECTION_INDICATOR_TO_SECTION[parts[2]]
            logger.debug(f"'{library_name}' -> section subject: stage={stage_code}, section={section_code}, subject={subject_code}, teacher={teacher_code}")
            return (stage_code, section_code, subject_code, teacher_code, teacher_name)

        # Unknown subject code
        logger.warning(f"Unknown subject code '{part1}' in '{library_name}'")
        return (stage_code, None, normalized_part1, teacher_code, teacher_name)

    except Exception as exc:
        logger.error(f"Error parsing library name '{library_name}': {exc}")
        return (None, None, None, None, None)


# ──────────────────────────────────────────────────────────────────────────────
# Payment calculation helpers
# ──────────────────────────────────────────────────────────────────────────────

def calculate_teacher_payment(
    section_revenue: float,
    teacher_watch_time_seconds: int,
    total_section_watch_time_seconds: int,
    revenue_percentage: float,
    tax_rate: float,
    section_order_percentage: float = 1.0,
) -> dict:
    """
    Calculate a teacher's payment for one section in one period.

    Args:
        section_revenue:                  Total EGP revenue for the section.
        teacher_watch_time_seconds:       This teacher's watch-time seconds.
        total_section_watch_time_seconds: Sum of ALL teachers' watch-time in section.
        revenue_percentage:               Teacher's share rate  (e.g. 0.95 = 95%).
        tax_rate:                         Tax rate              (e.g. 0.10 = 10%).
        section_order_percentage:         For common subjects - fraction of total orders
                                          that belong to this section (default 1.0).
    Returns:
        Dict with full calculation breakdown.
    """
    try:
        if total_section_watch_time_seconds == 0:
            watch_time_pct = 0.0
        else:
            watch_time_pct = teacher_watch_time_seconds / total_section_watch_time_seconds

        adjusted_pct  = watch_time_pct * section_order_percentage
        base_revenue  = section_revenue * adjusted_pct
        calc_revenue  = base_revenue * revenue_percentage
        tax_amount    = calc_revenue * tax_rate
        final_payment = calc_revenue - tax_amount

        return {
            'watch_time_percentage':          watch_time_pct,
            'section_order_percentage':       section_order_percentage,
            'adjusted_watch_time_percentage': adjusted_pct,
            'base_revenue':                   base_revenue,
            'revenue_percentage_applied':     revenue_percentage,
            'calculated_revenue':             calc_revenue,
            'tax_rate_applied':               tax_rate,
            'tax_amount':                     tax_amount,
            'final_payment':                  final_payment,
        }

    except Exception as exc:
        logger.error(f"Error calculating teacher payment: {exc}")
        return {
            'watch_time_percentage': 0.0, 'section_order_percentage': 0.0,
            'adjusted_watch_time_percentage': 0.0, 'base_revenue': 0.0,
            'revenue_percentage_applied': revenue_percentage,
            'calculated_revenue': 0.0, 'tax_rate_applied': tax_rate,
            'tax_amount': 0.0, 'final_payment': 0.0,
        }


def calculate_section_order_percentages(sections_data: list) -> dict:
    """
    Given a list of {'section_id': int, 'total_orders': int},
    return a dict mapping section_id -> fraction of total orders.
    Falls back to equal distribution when total_orders == 0.
    """
    try:
        total = sum(s.get('total_orders', 0) for s in sections_data)
        n = len(sections_data)
        if total == 0:
            return {s['section_id']: (1.0 / n if n else 0.0) for s in sections_data}
        return {s['section_id']: s.get('total_orders', 0) / total for s in sections_data}
    except Exception as exc:
        logger.error(f"Error calculating section order percentages: {exc}")
        return {}
