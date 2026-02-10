from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

# ============================================
# STAGE SCHEMAS
# ============================================

class StageBase(BaseModel):
    code: str = Field(..., description="Stage code (S1, M2, J4)")
    name: str = Field(..., description="Stage name (Senior 1, Middle 2)")
    display_order: Optional[int] = 0

class StageCreate(StageBase):
    pass

class StageUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    display_order: Optional[int] = None

class Stage(StageBase):
    id: int
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# ============================================
# SECTION SCHEMAS
# ============================================

class SectionBase(BaseModel):
    stage_id: int
    code: str = Field(..., description="Section code (AR, EN)")
    name: str = Field(..., description="Section name (Arabic Section)")

class SectionCreate(SectionBase):
    pass

class Section(SectionBase):
    id: int
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# ============================================
# SUBJECT SCHEMAS
# ============================================

class SubjectBase(BaseModel):
    code: str = Field(..., description="Subject code (MATH, AR, EN)")
    name: str = Field(..., description="Subject name (Mathematics)")
    is_common: bool = Field(False, description="Is this a common subject?")

class SubjectCreate(SubjectBase):
    pass

class Subject(SubjectBase):
    id: int
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# ============================================
# TEACHER ASSIGNMENT SCHEMAS
# ============================================

class TeacherAssignmentBase(BaseModel):
    library_id: int
    library_name: str
    stage_id: int
    section_id: Optional[int] = None
    subject_id: int
    tax_rate: float = Field(0.0, ge=0.0, le=1.0)
    revenue_percentage: float = Field(1.0, ge=0.0, le=1.0)

class TeacherAssignmentCreate(TeacherAssignmentBase):
    pass

class TeacherAssignmentUpdate(BaseModel):
    tax_rate: Optional[float] = Field(None, ge=0.0, le=1.0)
    revenue_percentage: Optional[float] = Field(None, ge=0.0, le=1.0)

class TeacherAssignment(TeacherAssignmentBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class TeacherAssignmentWithDetails(TeacherAssignment):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None
    subject_name: Optional[str] = None
    subject_is_common: Optional[bool] = None

# ============================================
# AUTO-MATCH SCHEMAS
# ============================================

class AutoMatchResult(BaseModel):
    library_id: int
    library_name: str
    stage_code: Optional[str] = None
    section_code: Optional[str] = None
    subject_code: Optional[str] = None
    matched: bool
    message: str

class AutoMatchResponse(BaseModel):
    total_libraries: int
    matched: int
    unmatched: int
    results: List[AutoMatchResult]

# ============================================
# FINANCIAL PERIOD SCHEMAS
# ============================================

class FinancialPeriodBase(BaseModel):
    name: str = Field(..., description="Period name (Q1 2025)")
    year: int = Field(..., description="Year (2025)")
    notes: Optional[str] = None

class FinancialPeriodCreate(FinancialPeriodBase):
    pass

class FinancialPeriodUpdate(BaseModel):
    name: Optional[str] = None
    year: Optional[int] = None
    notes: Optional[str] = None

class FinancialPeriod(FinancialPeriodBase):
    id: int
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# ============================================
# SECTION REVENUE SCHEMAS
# ============================================

class SectionRevenueBase(BaseModel):
    period_id: int
    stage_id: int
    section_id: int
    total_orders: int = Field(..., ge=0)
    total_revenue_egp: float = Field(..., ge=0.0)

class SectionRevenueCreate(SectionRevenueBase):
    pass

class SectionRevenueUpdate(BaseModel):
    total_orders: Optional[int] = Field(None, ge=0)
    total_revenue_egp: Optional[float] = Field(None, ge=0.0)

class SectionRevenue(SectionRevenueBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class SectionRevenueWithDetails(SectionRevenue):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None

# ============================================
# TEACHER PAYMENT SCHEMAS
# ============================================

class TeacherPayment(BaseModel):
    id: int
    period_id: int
    assignment_id: int
    library_id: int
    library_name: str
    stage_id: int
    section_id: int
    subject_id: int
    total_watch_time_seconds: int
    watch_time_percentage: float
    section_total_orders: int
    section_order_percentage: float
    base_revenue: float
    revenue_percentage_applied: float
    calculated_revenue: float
    tax_rate_applied: float
    tax_amount: float
    final_payment: float
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class TeacherPaymentWithDetails(TeacherPayment):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None
    subject_name: Optional[str] = None
    subject_is_common: Optional[bool] = None

# ============================================
# FINANCIAL DATA SCHEMAS
# ============================================

class FinancialData(BaseModel):
    period: FinancialPeriod
    stage: Stage
    sections: List[Section]
    section_revenues: List[SectionRevenueWithDetails]
    teacher_assignments: List[TeacherAssignmentWithDetails]
    teacher_payments: List[TeacherPaymentWithDetails]

class CalculatePaymentsRequest(BaseModel):
    period_id: int
    stage_id: int

class CalculatePaymentsResponse(BaseModel):
    success: bool
    message: str
    payments_calculated: int
    total_payment: float
    payments: List[TeacherPaymentWithDetails]
