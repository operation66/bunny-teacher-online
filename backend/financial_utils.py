# NEW FILE: /backend/financial_utils.py

"""
Helper functions for financial system
"""

import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Common subject codes that appear in all sections
COMMON_SUBJECT_CODES = ['AR', 'EN', 'HX', 'S.S']

# Section-specific subject codes
SECTION_SUBJECT_CODES = ['MATH', 'SCI', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY']

def parse_library_name(name: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Parse library name to extract stage code, section code, and subject code
    
    Examples:
        "S1-AR-P0046-Zakaria" -> ("S1", None, "AR")
        "J4-EN-MATH-Ahmed" -> ("J4", "EN", "MATH")
        "M2-AR-SCI-Mohamed" -> ("M2", "AR", "SCI")
        "S3-BIOLOGY-EN--Sarah" -> ("S3", "EN", "BIOLOGY")
    
    Returns:
        (stage_code, section_code, subject_code)
    """
    try:
        if not name:
            return (None, None, None)
        
        # Normalize: uppercase and split by hyphen
        parts = [p.strip().upper() for p in name.split('-') if p.strip()]
        
        if len(parts) == 0:
            return (None, None, None)
        
        stage_code = None
        section_code = None
        subject_code = None
        
        # First part is usually stage code (S1, M2, J4, etc.)
        first_part = parts[0]
        # Check if it matches stage pattern (letter followed by digit)
        if len(first_part) >= 2 and first_part[0] in ['S', 'M', 'J'] and first_part[1:].isdigit():
            stage_code = first_part
        
        # Look through remaining parts for subject and section
        for i, part in enumerate(parts[1:], start=1):
            # Check if this is a common subject
            if part in COMMON_SUBJECT_CODES:
                subject_code = part
                # Common subjects don't have a specific section
                section_code = None
                break
            
            # Check if this is a section-specific subject
            if part in SECTION_SUBJECT_CODES:
                subject_code = part
                # Look for section code in previous parts
                if i > 1 and parts[i-1] in ['AR', 'EN']:
                    section_code = parts[i-1]
                # Or look for section code after subject
                elif i + 1 < len(parts) and parts[i+1] in ['AR', 'EN']:
                    section_code = parts[i+1]
                break
            
            # Check if this part itself is a section indicator
            if part in ['AR', 'EN'] and i + 1 < len(parts):
                # Next part might be the subject
                next_part = parts[i+1]
                if next_part in SECTION_SUBJECT_CODES:
                    section_code = part
                    subject_code = next_part
                    break
        
        logger.info(f"Parsed '{name}' -> stage={stage_code}, section={section_code}, subject={subject_code}")
        return (stage_code, section_code, subject_code)
    
    except Exception as e:
        logger.error(f"Error parsing library name '{name}': {str(e)}")
        return (None, None, None)


def calculate_teacher_payment(
    section_revenue: float,
    teacher_watch_time_seconds: int,
    total_section_watch_time_seconds: int,
    revenue_percentage: float,
    tax_rate: float,
    section_order_percentage: float = 1.0
) -> dict:
    """
    Calculate teacher payment based on watch time percentage
    
    Args:
        section_revenue: Total revenue for the section (EGP)
        teacher_watch_time_seconds: Teacher's watch time in seconds
        total_section_watch_time_seconds: Total watch time for all teachers in section
        revenue_percentage: Teacher's revenue percentage (e.g., 0.80 for 80%)
        tax_rate: Teacher's tax rate (e.g., 0.10 for 10%)
        section_order_percentage: For common subjects, percentage of orders in this section
    
    Returns:
        Dictionary with calculation breakdown
    """
    try:
        # Calculate watch time percentage
        if total_section_watch_time_seconds == 0:
            watch_time_percentage = 0.0
        else:
            watch_time_percentage = teacher_watch_time_seconds / total_section_watch_time_seconds
        
        # Adjust watch time for common subjects based on order distribution
        adjusted_watch_time_percentage = watch_time_percentage * section_order_percentage
        
        # Calculate base revenue (before revenue % and tax)
        base_revenue = section_revenue * adjusted_watch_time_percentage
        
        # Apply revenue percentage
        calculated_revenue = base_revenue * revenue_percentage
        
        # Calculate tax
        tax_amount = calculated_revenue * tax_rate
        
        # Final payment after tax
        final_payment = calculated_revenue - tax_amount
        
        return {
            'watch_time_percentage': watch_time_percentage,
            'section_order_percentage': section_order_percentage,
            'adjusted_watch_time_percentage': adjusted_watch_time_percentage,
            'base_revenue': base_revenue,
            'revenue_percentage_applied': revenue_percentage,
            'calculated_revenue': calculated_revenue,
            'tax_rate_applied': tax_rate,
            'tax_amount': tax_amount,
            'final_payment': final_payment
        }
    
    except Exception as e:
        logger.error(f"Error calculating teacher payment: {str(e)}")
        return {
            'watch_time_percentage': 0.0,
            'section_order_percentage': 0.0,
            'adjusted_watch_time_percentage': 0.0,
            'base_revenue': 0.0,
            'revenue_percentage_applied': revenue_percentage,
            'calculated_revenue': 0.0,
            'tax_rate_applied': tax_rate,
            'tax_amount': 0.0,
            'final_payment': 0.0
        }


def calculate_section_order_percentages(sections_data: list) -> dict:
    """
    Calculate order percentage for each section
    
    Args:
        sections_data: List of dicts with 'section_id' and 'total_orders'
    
    Returns:
        Dict mapping section_id to order percentage
    """
    try:
        total_orders = sum(s.get('total_orders', 0) for s in sections_data)
        
        if total_orders == 0:
            # Equal distribution if no orders
            return {s['section_id']: 1.0 / len(sections_data) for s in sections_data}
        
        return {
            s['section_id']: s.get('total_orders', 0) / total_orders 
            for s in sections_data
        }
    
    except Exception as e:
        logger.error(f"Error calculating section order percentages: {str(e)}")
        return {}
