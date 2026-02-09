# NEW FILE: /backend/financial_models.py
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
    display_order = Column(Integer, default=0)  # For sorting
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    sections = relationship("Section", back_populates="stage", cascade="all, delete-orphan")
    teacher_assignments = relationship("TeacherAssignment", back_populates="stage")
    section_revenues = relationship("SectionRevenue", back_populates="stage")


class Section(Base):
    """Sections within stages (Arabic, English, Science, etc.)"""
    __tablename__ = "sections"
    
    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    code = Column(String(10), nullable=False)  # AR, EN, SCI
    name = Column(String(100), nullable=False)  # Arabic Section, English Section
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    stage = relationship("Stage", back_populates="sections")
    stage_section_subjects = relationship("StageSectionSubject", back_populates="section")
    teacher_assignments = relationship("TeacherAssignment", back_populates="section")
    section_revenues = relationship("SectionRevenue", back_populates="section")


class Subject(Base):
    """Subject definitions"""
    __tablename__ = "subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)  # MATH, AR, EN, HX, S.S, PHYSICS
    name = Column(String(100), nullable=False)  # Mathematics, Arabic, English
    is_common = Column(Boolean, default=False)  # Common subjects appear in all sections
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    stage_section_subjects = relationship("StageSectionSubject", back_populates="subject")
    teacher_assignments = relationship("TeacherAssignment", back_populates="subject")


class StageSectionSubject(Base):
    """Junction table: which subjects belong to which stage+section"""
    __tablename__ = "stage_section_subjects"
    
    id = Column(Integer, primary_key=True, index=True)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    section = relationship("Section", back_populates="stage_section_subjects")
    subject = relationship("Subject", back_populates="stage_section_subjects")


class TeacherAssignment(Base):
    """Assign teachers (libraries) to subjects with tax/revenue settings"""
    __tablename__ = "teacher_assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    library_id = Column(Integer, nullable=False)  # Bunny library ID
    library_name = Column(String(255), nullable=False)
    stage_id = Column(Integer, ForeignKey("stages.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=True)  # NULL for common subjects
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    tax_rate = Column(Float, default=0.0)  # e.g., 0.10 for 10%
    revenue_percentage = Column(Float, default=1.0)  # e.g., 0.80 for 80%
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC), onupdate=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    stage = relationship("Stage", back_populates="teacher_assignments")
    section = relationship("Section", back_populates="teacher_assignments")
    subject = relationship("Subject", back_populates="teacher_assignments")
    payments = relationship("TeacherPayment", back_populates="assignment")


class FinancialPeriod(Base):
    """Payment periods (4 per year, manually named)"""
    __tablename__ = "financial_periods"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)  # "Q1 2025", "Midterm 2025"
    year = Column(Integer, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
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
    
    # Relationships
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
    total_watch_time_seconds = Column(Integer, default=0)  # From Libraries page
    watch_time_percentage = Column(Float, default=0.0)  # % of section total
    
    # Revenue calculation
    section_total_orders = Column(Integer, default=0)
    section_order_percentage = Column(Float, default=0.0)  # For common subjects
    base_revenue = Column(Float, default=0.0)  # Before revenue % and tax
    revenue_percentage_applied = Column(Float, default=1.0)  # Teacher's revenue %
    calculated_revenue = Column(Float, default=0.0)  # After revenue %
    tax_rate_applied = Column(Float, default=0.0)  # Teacher's tax %
    tax_amount = Column(Float, default=0.0)
    final_payment = Column(Float, default=0.0)  # After tax
    
    created_at = Column(DateTime, default=lambda: datetime.now(pytz.UTC))
    
    # Relationships
    period = relationship("FinancialPeriod", back_populates="teacher_payments")
    assignment = relationship("TeacherAssignment", back_populates="payments")
