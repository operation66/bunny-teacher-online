# FILE: /backend/financial_models.py
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import pytz

class Stage(Base):
    """Educational stages (Junior 4-6, Middle 1-3, Senior 1-3)"""
    __tablename__ = "stages"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(10), unique=True, nullable=False)  # S1, M2, J4
    name = Column(String(100), nullable=False)  # Senior 1, Middle 2, Junior 4
    display_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    sections = relationship("Section", back_populates="stage", cascade="all, delete-orphan")
    teacher_assignments = relationship("TeacherAssignment", back_populates="stage")
    section_revenues = relationship("SectionRevenue", back_populates="stage")


class Section(Base):
    """Sections within stages (GEN, LANG)"""
    __tablename__ = "sections"
    
    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    code = Column(String(10), nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    stage = relationship("Stage", back_populates="sections")
    stage_section_subjects = relationship("StageSectionSubject", back_populates="section")
    teacher_assignments = relationship("TeacherAssignment", back_populates="section")
    section_revenues = relationship("SectionRevenue", back_populates="section")


class Subject(Base):
    """Subject definitions"""
    __tablename__ = "subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    is_common = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    stage_section_subjects = relationship("StageSectionSubject", back_populates="subject")
    teacher_assignments = relationship("TeacherAssignment", back_populates="subject")


class StageSectionSubject(Base):
    """Junction table"""
    __tablename__ = "stage_section_subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    section = relationship("Section", back_populates="stage_section_subjects")
    subject = relationship("Subject", back_populates="stage_section_subjects")


class TeacherAssignment(Base):
    """Assign teachers (libraries) to subjects"""
    __tablename__ = "teacher_assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    library_id = Column(Integer, nullable=False)
    library_name = Column(String(255), nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=True)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    tax_rate = Column(Float, default=0.0)
    revenue_percentage = Column(Float, default=1.0)
    teacher_profile_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC), onupdate=lambda: datetime.now(pytz.UTC))
    
    stage = relationship("Stage", back_populates="teacher_assignments")
    section = relationship("Section", back_populates="teacher_assignments")
    subject = relationship("Subject", back_populates="teacher_assignments")
    payments = relationship("TeacherPayment", back_populates="assignment")
    teacher_profile = relationship("TeacherProfile", back_populates="assignments")

class FinancialPeriod(Base):
    """Payment periods"""
    __tablename__ = "financial_periods"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    year = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    # ── NEW: list of month strings e.g. ["2025-10","2025-11","2025-12"]
    months = Column(JSON, nullable=True, default=list)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    section_revenues = relationship("SectionRevenue", back_populates="period", cascade="all, delete-orphan")
    teacher_payments = relationship("TeacherPayment", back_populates="period", cascade="all, delete-orphan")


class SectionRevenue(Base):
    """Revenue data for each section in each period"""
    __tablename__ = "section_revenues"
    
    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(Integer, ForeignKey("financial_periods.id"), nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    total_orders = Column(Integer, nullable=False, default=0)
    total_revenue_egp = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC), onupdate=lambda: datetime.now(pytz.UTC))
    
    period = relationship("FinancialPeriod", back_populates="section_revenues")
    stage = relationship("Stage", back_populates="section_revenues")
    section = relationship("Section", back_populates="section_revenues")


class TeacherPayment(Base):
    """Calculated teacher payments"""
    __tablename__ = "teacher_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(Integer, ForeignKey("financial_periods.id"), nullable=False)
    assignment_id = Column(Integer, ForeignKey("teacher_assignments.id"), nullable=False)
    library_id = Column(Integer, nullable=False)
    library_name = Column(String(255), nullable=False)
    stage_id = Column(Integer, nullable=False)
    section_id = Column(Integer, nullable=False)
    subject_id = Column(Integer, nullable=False)
    
    # Watch time data
    total_watch_time_seconds = Column(Integer, default=0)
    watch_time_percentage = Column(Float, default=0.0)
    # ── NEW: per-month breakdown stored as JSON {"2025-10": 3600, "2025-11": 7200, ...}
    monthly_watch_breakdown = Column(JSON, nullable=True, default=dict)
    
    # Revenue calculation
    section_total_orders = Column(Integer, default=0)
    section_order_percentage = Column(Float, default=0.0)
    base_revenue = Column(Float, default=0.0)
    revenue_percentage_applied = Column(Float, default=1.0)
    calculated_revenue = Column(Float, default=0.0)
    tax_rate_applied = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    final_payment = Column(Float, default=0.0)
    
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    period = relationship("FinancialPeriod", back_populates="teacher_payments")
    assignment = relationship("TeacherAssignment", back_populates="payments")

class TeacherProfile(Base):
    """
    One profile per real teacher (identified by P-code like P0046).
    Links multiple library assignments belonging to the same person.
    """
    __tablename__ = "teacher_profiles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(10), unique=True, nullable=False)   # P0046
    name = Column(String(255), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC),
                        onupdate=lambda: datetime.now(pytz.UTC))

    assignments = relationship("TeacherAssignment", back_populates="teacher_profile")
    finalizations = relationship("PaymentFinalization", back_populates="teacher_profile")


class CalculationAudit(Base):
    """
    Full audit trail for every calculation run.
    All runs are kept. The run active at finalization is linked via
    PaymentFinalization.audit_id.
    """
    __tablename__ = "calculation_audits"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(Integer, ForeignKey("financial_periods.id"), nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    triggered_by_user_id = Column(Integer, nullable=True)

    # overall status: "passed" | "warnings" | "failed"
    status = Column(String(20), nullable=False, default="passed")

    # JSON array of warning objects:
    # [{"code": "ZERO_WATCH_TIME_INCLUDED", "message": "...", "severity": "warning",
    #   "library_id": 123, "library_name": "..."}]
    warnings = Column(JSON, nullable=True, default=list)

    # Snapshot of every input used — section revenues, watch times, excluded libs
    inputs_snapshot = Column(JSON, nullable=True, default=dict)

    # Snapshot of outputs — {library_id: final_payment}
    outputs_snapshot = Column(JSON, nullable=True, default=dict)

    # Cross-validation result
    verification_status = Column(String(20), nullable=False, default="matched")
    verification_delta = Column(Float, nullable=True, default=0.0)

    # Admin acknowledgement
    acknowledged = Column(Boolean, default=False)
    acknowledged_by_user_id = Column(Integer, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))

    period = relationship("FinancialPeriod")
    stage = relationship("Stage")


class PaymentFinalization(Base):
    """
    Records the admin's finalization decision for one teacher/stage/section
    in one period. Transfer % is set here manually.
    Carry-forward flows: carry_forward_out from period N becomes
    carry_forward_in for the same teacher/stage/section in period N+1.
    """
    __tablename__ = "payment_finalizations"

    id = Column(Integer, primary_key=True, index=True)
    period_id = Column(Integer, ForeignKey("financial_periods.id"), nullable=False)
    teacher_profile_id = Column(Integer, ForeignKey("teacher_profiles.id"), nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    audit_id = Column(Integer, ForeignKey("calculation_audits.id"), nullable=True)

    gross_payment = Column(Float, nullable=False, default=0.0)
    carry_forward_in = Column(Float, nullable=False, default=0.0)
    total_due = Column(Float, nullable=False, default=0.0)
    transfer_percentage = Column(Float, nullable=False, default=1.0)
    transfer_amount = Column(Float, nullable=False, default=0.0)
    carry_forward_out = Column(Float, nullable=False, default=0.0)

    notes = Column(Text, nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))

    period = relationship("FinancialPeriod")
    teacher_profile = relationship("TeacherProfile", back_populates="finalizations")
    stage = relationship("Stage")
    section = relationship("Section")
    audit = relationship("CalculationAudit")
