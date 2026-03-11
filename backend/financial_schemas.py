# FILE: /backend/financial_schemas.py
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# ── STAGE ─────────────────────────────────────────────────────────────────────

class StageBase(BaseModel):
    code: str = Field(..., description="Stage code e.g. S1, M2, J4")
    name: str = Field(..., description="Stage name e.g. Senior 1")
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
        orm_mode = True

# ── SECTION ───────────────────────────────────────────────────────────────────

class SectionBase(BaseModel):
    stage_id: int
    code: str = Field(..., description="Section code e.g. GEN, LANG")
    name: str = Field(..., description="Section name e.g. General Section")

class SectionCreate(SectionBase):
    pass

class Section(SectionBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        orm_mode = True

# ── SUBJECT ───────────────────────────────────────────────────────────────────

class SubjectBase(BaseModel):
    code: str = Field(..., description="Subject code e.g. MATH, AR, ISC, BIO")
    name: str = Field(..., description="Subject name e.g. Mathematics, Arabic")
    is_common: bool = Field(False, description="True = appears in all sections")

class SubjectCreate(SubjectBase):
    pass

class Subject(SubjectBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        orm_mode = True

# ── TEACHER ASSIGNMENT ────────────────────────────────────────────────────────

class TeacherAssignmentBase(BaseModel):
    library_id: int
    library_name: str
    stage_id: int
    section_id: Optional[int] = None
    subject_id: int
    tax_rate: float = Field(0.0, ge=0.0, le=1.0)
    revenue_percentage: float = Field(0.95, ge=0.0, le=1.0)
    teacher_profile_id: Optional[int] = None
    
class TeacherAssignmentCreate(TeacherAssignmentBase):
    pass

class TeacherAssignmentUpdate(BaseModel):
    section_id: Optional[int] = None
    subject_id: Optional[int] = None
    tax_rate: Optional[float] = Field(None, ge=0.0, le=1.0)
    revenue_percentage: Optional[float] = Field(None, ge=0.0, le=1.0)

class TeacherAssignment(TeacherAssignmentBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        orm_mode = True

class TeacherAssignmentWithDetails(TeacherAssignment):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None
    subject_name: Optional[str] = None
    subject_is_common: Optional[bool] = None
    teacher_profile_code: Optional[str] = None
    teacher_profile_name: Optional[str] = None
    
# ── AUTO-MATCH ────────────────────────────────────────────────────────────────

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

# ── FINANCIAL PERIOD ──────────────────────────────────────────────────────────

class FinancialPeriodBase(BaseModel):
    name: str = Field(..., description="Period name e.g. Q1 2025")
    year: int
    notes: Optional[str] = None
    # List of month strings e.g. ["2025-10","2025-11","2025-12"]
    months: Optional[List[str]] = Field(default_factory=list, description="Selected months for this period")

class FinancialPeriodCreate(FinancialPeriodBase):
    pass

class FinancialPeriodUpdate(BaseModel):
    name: Optional[str] = None
    year: Optional[int] = None
    notes: Optional[str] = None
    months: Optional[List[str]] = None

class FinancialPeriod(FinancialPeriodBase):
    id: int
    created_at: Optional[datetime] = None
    class Config:
        orm_mode = True

# ── SECTION REVENUE ───────────────────────────────────────────────────────────

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
        orm_mode = True

class SectionRevenueWithDetails(SectionRevenue):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None

# ── TEACHER PAYMENT ───────────────────────────────────────────────────────────

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
    # NEW: per-month breakdown for hover tooltip
    monthly_watch_breakdown: Optional[Dict[str, int]] = Field(default_factory=dict)
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
        orm_mode = True

class TeacherPaymentWithDetails(TeacherPayment):
    stage_name: Optional[str] = None
    section_name: Optional[str] = None
    subject_name: Optional[str] = None
    subject_is_common: Optional[bool] = None

# ── LIBRARY PREVIEW (for approval popup) ──────────────────────────────────────

class LibraryPreview(BaseModel):
    library_id: int
    library_name: str
    subject_name: Optional[str] = None
    subject_is_common: Optional[bool] = None
    section_name: Optional[str] = None
    total_watch_time_seconds: int
    monthly_watch_breakdown: Dict[str, int]
    has_analytics: bool  # False if all months are 0

class LibraryPreviewResponse(BaseModel):
    period_months: List[str]
    libraries: List[LibraryPreview]
    no_analytics_count: int

# ── AGGREGATE ─────────────────────────────────────────────────────────────────

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
    excluded_library_ids: Optional[List[int]] = Field(default_factory=list)

# ── TEACHER PROFILE ───────────────────────────────────────────────────────────

class TeacherProfileBase(BaseModel):
    code: str = Field(..., description="Teacher P-code e.g. P0046")
    name: str
    notes: Optional[str] = None

class TeacherProfileCreate(TeacherProfileBase):
    pass

class TeacherProfileUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None

class TeacherProfile(TeacherProfileBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config:
        orm_mode = True

class UnlinkedAssignment(BaseModel):
    library_id: int
    library_name: str
    reason: str  # "no_p_code" | "p_code_not_in_db"

class AutoLinkResponse(BaseModel):
    total_assignments: int
    linked: int
    already_linked: int
    unlinked: int
    profiles_created: int
    unlinked_assignments: List[UnlinkedAssignment]

# ── CALCULATION AUDIT ─────────────────────────────────────────────────────────

class AuditWarning(BaseModel):
    code: str
    message: str
    severity: str  # "warning" | "critical"
    library_id: Optional[int] = None
    library_name: Optional[str] = None

class CalculationAuditSummary(BaseModel):
    id: int
    period_id: int
    stage_id: int
    status: str
    warnings: List[AuditWarning] = []
    verification_status: str
    verification_delta: Optional[float] = None
    acknowledged: bool
    created_at: Optional[datetime] = None
    class Config:
        orm_mode = True

class AcknowledgeAuditRequest(BaseModel):
    user_id: Optional[int] = None

# ── FINALIZATION ──────────────────────────────────────────────────────────────

class FinalizationRowInput(BaseModel):
    teacher_profile_id: int
    stage_id: int
    section_id: int
    transfer_percentage: float = Field(..., ge=0.0, le=1.0)
    notes: Optional[str] = None

class SubmitFinalizationRequest(BaseModel):
    period_id: int
    audit_id: int
    rows: List[FinalizationRowInput]

class FinalizationPreviewRow(BaseModel):
    teacher_profile_id: int
    teacher_code: str
    teacher_name: str
    stage_id: int
    stage_code: str
    stage_name: str
    section_id: int
    section_code: str
    section_name: str
    gross_payment: float
    carry_forward_in: float
    total_due: float
    already_finalized: bool
    existing_transfer_percentage: Optional[float] = None
    existing_transfer_amount: Optional[float] = None
    existing_carry_forward_out: Optional[float] = None

class FinalizationPreviewResponse(BaseModel):
    period_id: int
    period_name: str
    next_period_exists: bool
    next_period_name: Optional[str] = None
    latest_audit_id: Optional[int] = None
    audit_acknowledged: bool
    rows: List[FinalizationPreviewRow]

class FinalizationRecord(BaseModel):
    id: int
    period_id: int
    teacher_profile_id: int
    teacher_code: Optional[str] = None
    teacher_name: Optional[str] = None
    stage_id: int
    stage_code: Optional[str] = None
    section_id: int
    section_code: Optional[str] = None
    gross_payment: float
    carry_forward_in: float
    total_due: float
    transfer_percentage: float
    transfer_amount: float
    carry_forward_out: float
    notes: Optional[str] = None
    finalized_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    class Config:
        orm_mode = True

# ── REPORT ────────────────────────────────────────────────────────────────────

class ReportColumnConfig(BaseModel):
    key: str
    label: str
    visible: bool = True

class ComparativeTeacherConfig(BaseModel):
    teacher_profile_id: int
    columns: List[str]  # which columns to show for this teacher

class ReportConfig(BaseModel):
    report_type: str  # "teacher" | "period_summary" | "comparison" | "carry_forward"
    period_ids: List[int] = []
    stage_ids: List[int] = []
    section_ids: List[int] = []
    subject_ids: List[int] = []
    teacher_profile_ids: List[int] = []
    columns: List[str] = []
    group_by: Optional[str] = None       # "teacher"|"stage"|"section"|"subject"|"period"
    group_by_secondary: Optional[str] = None
    show_subtotals: bool = True
    show_grand_total: bool = True
    sort_by: Optional[str] = None
    sort_direction: str = "desc"
    comparative_teachers: Optional[List[ComparativeTeacherConfig]] = None

class ReportRow(BaseModel):
    row_type: str  # "data" | "subtotal" | "grand_total" | "comparative"
    group_label: Optional[str] = None
    data: Dict[str, Any] = {}

class ReportResponse(BaseModel):
    config: ReportConfig
    columns: List[ReportColumnConfig]
    rows: List[ReportRow]
    generated_at: datetime
    total_rows: int

# ── DASHBOARD ─────────────────────────────────────────────────────────────────

class DashboardKPIs(BaseModel):
    total_finalized_egp: float
    total_outstanding_egp: float
    active_teachers_count: int
    total_watch_time_seconds: int
    period_id: Optional[int] = None
    period_name: Optional[str] = None

class PeriodStageCell(BaseModel):
    period_id: int
    period_name: str
    stage_id: int
    stage_code: str
    calculated_total: float
    finalized_total: float
    outstanding_total: float

class TeacherRankingRow(BaseModel):
    teacher_profile_id: Optional[int] = None
    teacher_name: str
    teacher_code: Optional[str] = None
    value: float
    metric: str  # "payment" | "watch_time" | "watch_pct"

class DashboardSummaryResponse(BaseModel):
    kpis: DashboardKPIs
    matrix: List[PeriodStageCell]
    teacher_rankings: List[TeacherRankingRow]
    periods: List[dict]
    stages: List[dict]

class DashboardComparisonRequest(BaseModel):
    x_axis: str   # "teacher"|"stage"|"section"|"subject"|"period"
    y_axis: str   # "payment"|"watch_time"|"watch_pct"|"carry_forward"|"orders"
    period_ids: List[int] = []
    stage_ids: List[int] = []
    section_ids: List[int] = []
    use_finalized: bool = False

class DashboardComparisonRow(BaseModel):
    label: str
    value: float
    secondary_id: Optional[int] = None

class DashboardComparisonResponse(BaseModel):
    x_axis: str
    y_axis: str
    rows: List[DashboardComparisonRow]

class CalculatePaymentsResponse(BaseModel):
    success: bool
    message: str
    payments_calculated: int
    total_payment: float
    payments: List[TeacherPaymentWithDetails]
    audit_id: Optional[int] = None
    audit_status: Optional[str] = None
    audit_warnings: Optional[List[dict]] = None
