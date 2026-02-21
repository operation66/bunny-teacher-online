from sqlalchemy import Column, Integer, String, Float, ForeignKey, Date, Text, Boolean, DateTime, JSON, UniqueConstraint as models_UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from financial_models import (
    Stage, Section, Subject, StageSectionSubject,
    TeacherAssignment, FinancialPeriod, SectionRevenue,
    TeacherPayment, Base as FinancialBase
)

class LibraryConfig(Base):
    __tablename__ = "library_configs"

    id = Column(Integer, primary_key=True, index=True)
    library_id = Column(Integer, nullable=False, unique=True)  # Bunny library ID
    library_name = Column(String, nullable=False)  # Library name from Bunny.net
    stream_api_key = Column(String, nullable=True)  # Stream API key for this specific library
    is_active = Column(Boolean, default=True)  # Whether to fetch stats for this library
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

class Teacher(Base):
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Library name from Bunny.net
    bunny_library_id = Column(Integer, nullable=False, unique=True)  # Bunny library ID
    
    # Relationships
    monthly_stats = relationship("MonthlyStats", back_populates="teacher")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    allowed_pages = Column(JSON, nullable=False, default=list)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

class MonthlyStats(Base):
    __tablename__ = "monthly_stats"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    
    # Video stats from Bunny.net
    video_views = Column(Integer, default=0)
    bandwidth_gb = Column(Float, default=0.0)
    total_watch_time_seconds = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationship
    teacher = relationship("Teacher", back_populates="monthly_stats")

class LibraryHistoricalStats(Base):
    __tablename__ = "library_historical_stats"

    id = Column(Integer, primary_key=True, index=True)
    library_id = Column(Integer, nullable=False)  # Bunny library ID
    library_name = Column(String, nullable=False)  # Library name from Bunny.net
    month = Column(Integer, nullable=False)  # 1-12
    year = Column(Integer, nullable=False)  # e.g., 2024
    
    # Statistics from Bunny.net API
    total_views = Column(Integer, default=0)
    total_watch_time_seconds = Column(Integer, default=0)
    bandwidth_gb = Column(Float, default=0.0)
    
    # Chart data stored as JSON
    views_chart = Column(JSON, nullable=True)  # Daily views data
    watch_time_chart = Column(JSON, nullable=True)  # Daily watch time data
    bandwidth_chart = Column(JSON, nullable=True)  # Daily bandwidth data
    
    # Additional metadata
    fetch_date = Column(DateTime, default=func.now())  # When this data was fetched
    is_synced = Column(Boolean, default=False)  # Whether synced to Libraries page
    sync_date = Column(DateTime, nullable=True)  # When synced
    
    # Timestamps
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Unique constraint to prevent duplicate entries for same library/month/year
    __table_args__ = (
        models_UniqueConstraint('library_id', 'month', 'year', name='uq_library_month_year'),
    )
