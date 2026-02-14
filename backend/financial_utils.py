# FILE: /backend/financial_utils.py
"""
Helper functions for the financial system.
FIXED: parse_library_name now correctly identifies subject vs section indicator.

KEY RULE:
  - Part directly after stage (pos 1) → could be a SUBJECT CODE or COMMON SUBJECT
  - If part1 is a known-common code (AR, EN, HX, SS, S.S) → it IS the subject (common, no section)
  - If part1 is anything else (ISC, BIO, CH, MATH, PHYS, CHEM…) → it is the SUBJECT CODE
      and the NEXT part (pos 2) is checked: AR → GEN section, EN → LANG section
  - "(OLD)" / "(0LD)" prefixes are stripped before parsing
"""

import re
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# These codes ARE subjects AND are always "common" (appear in both GEN + LANG sections)
# When one of these appears immediately after the stage code it is the SUBJECT, not a section indicator
COMMON_SUBJECT_CODES = {'AR', 'EN', 'HX', 'SS', 'S.S', 'HIST', 'GEO', 'SOC'}

# When AR or EN appears AFTER a non-common subject code, it is a SECTION INDICATOR, not a subject
SECTION_INDICATOR_TO_SECTION = {
    'AR': 'GEN',   # taught in Arabic  → GEN section
    'EN': 'LANG',  # taught in English → LANG section
}


def parse_library_name(library_name: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Parse a Bunny library name into (stage_code, section_code, subject_code).

    section_code is None for common subjects (they belong to ALL sections).
    section_code is 'GEN' or 'LANG' for section-specific subjects.

    Examples (verified against real data):
        "S1-AR-P0046-Zakaria"           → ('S1', None,  'AR')   common subject
        "S1-AR-P0138-Abdelrahman"       → ('S1', None,  'AR')   common subject
        "S1-EN-P0046-Teacher"           → ('S1', None,  'EN')   common subject
        "S1-HX-P0046-Teacher"           → ('S1', None,  'HX')   common subject
        "S1-ISC-AR-P0022-Mohamed Sakr"  → ('S1', 'GEN', 'ISC')  AR after ISC = GEN
        "S1-ISC-AR-P0056-Mohamed Yasser"→ ('S1', 'GEN', 'ISC')
        "S2-BIO-AR-Menna Gamal"         → ('S2', 'GEN', 'BIO')  AR after BIO = GEN
        "S2-CH-AR-P0022-Mohamed Sakr"   → ('S2', 'GEN', 'CH')
        "S1-MATH-AR-Teacher"            → ('S1', 'GEN', 'MATH')
        "S1-MATH-EN-Teacher"            → ('S1', 'LANG','MATH')
        "(0LD)S1-MATH-EN--Shady"        → ('S1', 'LANG','MATH')  prefix stripped
    """
    try:
        if not library_name:
            return (None, None, None)

        name = library_name.strip()

        # Strip leading qualifiers like "(OLD)", "(0LD)", "[OLD]" etc.
        name = re.sub(r'^\s*[\(\[][^\)\]]*[\)\]]\s*', '', name)

        # Split on hyphens (one or more) – handles double-dash separators too
        parts = [p.strip().upper() for p in re.split(r'-+', name) if p.strip()]

        if len(parts) < 2:
            logger.warning(f"Too few parts to parse '{library_name}': {parts}")
            return (None, None, None)

        # ── STAGE (always first part, pattern: letter + digit(s)) ──────────────
        first = parts[0]
        if not re.match(r'^[A-Z]\d+$', first):
            logger.warning(f"First part '{first}' not a stage code in '{library_name}'")
            return (None, None, None)
        stage_code = first          # e.g. S1, M2, J4

        # ── SUBJECT & SECTION (look at parts[1] and parts[2]) ──────────────────
        part2 = parts[1]           # position immediately after stage

        if part2 in COMMON_SUBJECT_CODES:
            # e.g. S1-AR-…  or  S1-HX-…
            # This code IS the subject. It is common (no specific section).
            subject_code = part2
            section_code = None
            logger.debug(f"'{library_name}' → stage={stage_code}, common subject={subject_code}")
            return (stage_code, section_code, subject_code)

        else:
            # e.g. S1-ISC-AR-…  or  S2-BIO-AR-…  or  S1-MATH-EN-…
            # part2 is the SUBJECT CODE.
            subject_code = part2
            section_code = None   # default: unknown / not matched yet

            if len(parts) >= 3:
                part3 = parts[2]
                if part3 in SECTION_INDICATOR_TO_SECTION:
                    section_code = SECTION_INDICATOR_TO_SECTION[part3]
                    # e.g. AR → 'GEN',  EN → 'LANG'

            logger.debug(
                f"'{library_name}' → stage={stage_code}, section={section_code}, subject={subject_code}"
            )
            return (stage_code, section_code, subject_code)

    except Exception as exc:
        logger.error(f"Error parsing library name '{library_name}': {exc}")
        return (None, None, None)


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
        revenue_percentage:               Teacher's share rate  (e.g. 0.95 = 95 %).
        tax_rate:                         Tax rate              (e.g. 0.10 = 10 %).
        section_order_percentage:         For common subjects – fraction of total orders
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
            'watch_time_percentage':       watch_time_pct,
            'section_order_percentage':    section_order_percentage,
            'adjusted_watch_time_percentage': adjusted_pct,
            'base_revenue':                base_revenue,
            'revenue_percentage_applied':  revenue_percentage,
            'calculated_revenue':          calc_revenue,
            'tax_rate_applied':            tax_rate,
            'tax_amount':                  tax_amount,
            'final_payment':               final_payment,
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
    return a dict mapping section_id → fraction of total orders.
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
