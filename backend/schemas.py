from pydantic import BaseModel, EmailStr, validator, Field
from typing import Optional, List, Dict, Any
try:
    from typing import Literal
except ImportError:
    from typing_extensions import Literal
from enum import Enum
from datetime import datetime
from financial_schemas import *

# Library Config schemas
class LibraryConfigBase(BaseModel):
    library_id: int
    library_name: str
    stream_api_key: Optional[str] = None
    is_active: Optional[bool] = True

class LibraryConfigCreate(LibraryConfigBase):
    pass

class LibraryConfigUpdate(BaseModel):
    library_name: Optional[str] = None
    stream_api_key: Optional[str] = None
    is_active: Optional[bool] = None

class LibraryConfig(LibraryConfigBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# Teacher schemas
class TeacherBase(BaseModel):
    name: str
    bunny_library_id: int

class TeacherCreate(TeacherBase):
    pass

class Teacher(TeacherBase):
    id: int

    class Config:
        orm_mode = True

# User schemas
class UserBase(BaseModel):
    email: EmailStr
    allowed_pages: List[str]
    is_active: Optional[bool] = True

class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)

class UserUpdate(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    allowed_pages: Optional[List[str]] = None
    is_active: Optional[bool] = None

class User(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    success: bool
    message: str
    user_id: int
    email: str
    allowed_pages: List[str]

# Monthly Stats schema
class MonthlyStats(BaseModel):
    id: int
    teacher_id: int
    month: int
    year: int
    video_views: Optional[int] = None
    bandwidth_gb: Optional[float] = None
    total_watch_time_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# Quality Report schemas
class QualityReportCreate(BaseModel):
    teacher_id: int
    month: int
    year: int
    quality_score: float
    quality_summary: Optional[str] = None

class QualityReport(QualityReportCreate):
    id: int
    uploaded_at: datetime

    class Config:
        orm_mode = True

# Student Report schemas
class StudentReportCreate(BaseModel):
    teacher_id: int
    month: int
    year: int
    student_feedback_score: float
    student_feedback_summary: Optional[str] = None

class StudentReport(StudentReportCreate):
    id: int
    uploaded_at: datetime

    class Config:
        orm_mode = True

# Operations Report schemas
class OperationsReportCreate(BaseModel):
    teacher_id: int
    month: int
    year: int
    operations_on_schedule: bool
    operations_attitude_summary: Optional[str] = None

class OperationsReport(OperationsReportCreate):
    id: int
    uploaded_at: datetime

    class Config:
        orm_mode = True

# Bunny.net Library schema
class BunnyLibrary(BaseModel):
    id: int
    name: str
    video_views: int
    total_watch_time_seconds: int

# Upsert Teachers from Bunny Libraries
class UpsertResult(BaseModel):
    bunny_library_id: int
    name: str
    action: str  # created, updated, unchanged, error
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None

class UpsertTeachersResponse(BaseModel):
    success: bool
    total_libraries: int
    created: int
    updated: int
    unchanged: int
    failed: int
    results: List[UpsertResult]

# Report schemas
class ReportType(str, Enum):
    quality = "quality"
    student = "student"
    operations = "operations"

class ExcelUploadResponse(BaseModel):
    success: bool
    message: str
    teacher_id: int
    month: int
    year: int
    report_type: str

class UploadHistory(BaseModel):
    id: int
    teacher_name: str
    report_type: str
    month: int
    year: int
    uploaded_at: datetime

# Historical Stats schemas
class LibraryHistoricalStatsBase(BaseModel):
    library_id: int
    library_name: str
    month: int
    year: int
    total_views: Optional[int] = 0
    total_watch_time_seconds: Optional[int] = 0
    bandwidth_gb: Optional[float] = 0.0
    views_chart: Optional[Dict[str, Any]] = None
    watch_time_chart: Optional[Dict[str, Any]] = None
    bandwidth_chart: Optional[Dict[str, Any]] = None

class LibraryHistoricalStatsCreate(LibraryHistoricalStatsBase):
    pass

class LibraryHistoricalStats(LibraryHistoricalStatsBase):
    id: int
    fetch_date: datetime
    is_synced: bool
    sync_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True

# Batch fetch request/response schemas
class BatchFetchRequest(BaseModel):
    library_ids: List[int]
    month: int
    year: int

class LibraryFetchStatus(BaseModel):
    library_id: int
    library_name: str
    status: str  # "success", "error", "skipped"
    success: bool  # For frontend compatibility
    message: str
    error: Optional[str] = None  # For frontend compatibility
    data: Optional[LibraryHistoricalStats] = None

class BatchFetchResponse(BaseModel):
    success: bool
    message: str
    total_libraries: int
    successful_fetches: int
    failed_fetches: int
    skipped_fetches: int
    results: List[LibraryFetchStatus]

# Sync request/response schemas
class SyncRequest(BaseModel):
    library_ids: Optional[List[int]] = None  # If None, sync all unsynced
    month: int
    year: int

class LibrarySyncStatus(BaseModel):
    library_id: int
    library_name: str
    status: str  # "synced", "error", "already_synced"
    success: bool  # For frontend compatibility
    message: str
    error: Optional[str] = None  # For frontend compatibility

class SyncResponse(BaseModel):
    success: bool
    message: str
    total_libraries: int
    synced_libraries: int
    failed_syncs: int
    already_synced: int
    results: List[LibrarySyncStatus]

# Libraries page data schemas
class MonthlyData(BaseModel):
    month: int
    year: int
    total_views: int
    total_watch_time_seconds: int
    bandwidth_gb: float
    fetch_date: datetime

class LibraryWithHistory(BaseModel):
    library_id: int
    library_name: str
    has_stats: bool
    monthly_data: List[MonthlyData]
    last_updated: Optional[datetime] = None
