from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, Form
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List
import logging
from passlib.context import CryptContext
from jose import jwt, JWTError
from fastapi.security import OAuth2PasswordBearer
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import os
from dotenv import load_dotenv

# MUST load env vars FIRST before anything else
load_dotenv()

import models
import schemas
import pytz
from database import engine, get_db, SessionLocal
from bunny_service import get_bunny_stats, get_bunny_libraries, get_library_monthly_stats

from financial_models import (
    Stage, Section, Subject, StageSectionSubject,
    TeacherAssignment, FinancialPeriod, SectionRevenue, TeacherPayment,
    Base as FinancialBase
)
from financial_schemas import (
    Stage as StageSchema, StageCreate, StageUpdate,
    Section as SectionSchema, SectionCreate,
    Subject as SubjectSchema, SubjectCreate,
    TeacherAssignment as TeacherAssignmentSchema,
    TeacherAssignmentCreate, TeacherAssignmentUpdate,
    TeacherAssignmentWithDetails,
    AutoMatchResponse, AutoMatchResult,
    FinancialPeriod as FinancialPeriodSchema,
    FinancialPeriodCreate, FinancialPeriodUpdate,
    SectionRevenue as SectionRevenueSchema,
    SectionRevenueCreate, SectionRevenueUpdate,
    SectionRevenueWithDetails,
    TeacherPaymentWithDetails,
    FinancialData,
    CalculatePaymentsRequest,
    CalculatePaymentsResponse
)
from financial_utils import parse_library_name, calculate_teacher_payment, calculate_section_order_percentages

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create ALL database tables on startup
try:
    logger.info("Creating main database tables...")
    models.Base.metadata.create_all(bind=engine)
    logger.info("✅ Main tables created")
except Exception as e:
    logger.error(f"❌ Failed to create main tables: {e}")

try:
    logger.info("Creating financial database tables...")
    FinancialBase.metadata.create_all(bind=engine)
    logger.info("✅ Financial tables created")
except Exception as e:
    logger.error(f"❌ Failed to create financial tables: {e}")

try:
    logger.info("Checking for missing columns in financial tables...")
    from sqlalchemy import text as sql_text

    with engine.begin() as conn:
        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='financial_periods' AND column_name='months'"
        )).fetchone()
        if not result:
            logger.info("Adding 'months' column to financial_periods...")
            conn.execute(sql_text("ALTER TABLE financial_periods ADD COLUMN months JSON"))
            logger.info("✅ Added months column")

        result = conn.execute(sql_text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='teacher_payments' AND column_name='monthly_watch_breakdown'"
        )).fetchone()
        if not result:
            logger.info("Adding 'monthly_watch_breakdown' column to teacher_payments...")
            conn.execute(sql_text("ALTER TABLE teacher_payments ADD COLUMN monthly_watch_breakdown JSON"))
            logger.info("✅ Added monthly_watch_breakdown column")

    logger.info("✅ Financial table migrations complete")
except Exception as e:
    logger.error(f"❌ Migration error (non-fatal): {e}")

# Create FastAPI app
app = FastAPI(title="Elkheta Teacher Performance Dashboard")

# CORS
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://bunny-teacher-online.onrender.com",
    "https://bunny-teacher-online.vercel.app",
]
extra = os.getenv("ALLOWED_ORIGINS", "")
if extra:
    allowed_origins += [o.strip() for o in extra.split(",") if o.strip()]

logger.info(f"CORS allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?:\/\/(localhost|127\.0\.0\.1|\S+\.vercel\.app|\S+\.onrender\.com)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ============================================
# USERS AND AUTHENTICATION
# ============================================

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user

def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pwd_context.verify(password, password_hash)
    except Exception:
        return False


# ============================================
# TEACHERS
# ============================================

@app.post("/teachers/upsert-from-bunny/", response_model=schemas.UpsertTeachersResponse)
async def upsert_teachers_from_bunny(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()

        if not libraries:
            config_items = db.query(models.LibraryConfig).all()
            libraries = [{"id": cfg.library_id, "name": cfg.library_name} for cfg in config_items]

        config_names = {cfg.library_id: cfg.library_name for cfg in db.query(models.LibraryConfig).all()}

        results: List[schemas.UpsertResult] = []
        created = updated = unchanged = failed = 0

        for lib in libraries:
            lib_id = lib.get("id")
            lib_name = lib.get("name")
            display_name = config_names.get(lib_id) or lib_name or f"Library {lib_id}"

            try:
                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == lib_id).first()
                if teacher:
                    if teacher.name != display_name:
                        teacher.name = display_name
                        action = "updated"
                        updated += 1
                    else:
                        action = "unchanged"
                        unchanged += 1
                else:
                    teacher = models.Teacher(name=display_name, bunny_library_id=lib_id)
                    db.add(teacher)
                    action = "created"
                    created += 1

                results.append(schemas.UpsertResult(
                    bunny_library_id=lib_id, name=display_name,
                    action=action, success=True, message="OK"
                ))
            except Exception as e:
                logger.error(f"Teacher upsert failed for library {lib_id}: {str(e)}")
                failed += 1
                results.append(schemas.UpsertResult(
                    bunny_library_id=lib_id, name=display_name,
                    action="error", success=False,
                    message=f"Failed to upsert library {lib_id}", error=str(e)
                ))

        db.commit()

        return schemas.UpsertTeachersResponse(
            success=True, total_libraries=len(libraries),
            created=created, updated=updated, unchanged=unchanged, failed=failed, results=results
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Error upserting teachers from Bunny libraries: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.get("/teachers/", response_model=List[schemas.Teacher])
def read_teachers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Teacher).offset(skip).limit(limit).all()


@app.get("/teachers/{teacher_id}", response_model=schemas.Teacher)
def read_teacher(teacher_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return db_teacher


@app.get("/teachers/{teacher_id}/monthly-stats", response_model=List[schemas.MonthlyStats])
def get_teacher_monthly_stats(teacher_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if db_teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found")
    return db.query(models.MonthlyStats).filter(
        models.MonthlyStats.teacher_id == teacher_id
    ).order_by(models.MonthlyStats.year.desc(), models.MonthlyStats.month.desc()).all()


# ============================================
# BUNNY LIBRARIES
# ============================================

@app.get("/bunny-libraries/", response_model=List[schemas.BunnyLibrary])
async def fetch_bunny_libraries(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()
        formatted_libraries = []
        for library in libraries:
            lib_id = library.get("id")
            lib_name = library.get("name")
            try:
                cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == lib_id).first()
                if cfg and cfg.library_name:
                    lib_name = cfg.library_name
            except Exception:
                pass
            formatted_libraries.append({"id": lib_id, "name": lib_name, "video_views": 0, "total_watch_time_seconds": 0})

        if not formatted_libraries:
            logger.warning("Bunny.net API unavailable, returning empty list")
            return []
        return formatted_libraries

    except Exception as e:
        logger.error(f"Error in fetch_bunny_libraries: {str(e)}")
        return []

@app.post("/bunny-libraries/sync-stats/")
async def sync_library_stats(request: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        library_ids = request.get("library_ids", [])
        month = request.get("month", datetime.now().month)
        year = request.get("year", datetime.now().year)

        if not library_ids:
            raise HTTPException(status_code=400, detail="No library IDs provided")

        synced_libraries = []

        for library_id in library_ids:
            try:
                stats_data = await get_library_monthly_stats(library_id, month, year, db)
                if not stats_data or "error" in stats_data:
                    logger.error(f"Failed to get stats for library {library_id} - skipping")
                    continue

                views = stats_data.get("total_views", 0)
                watch_time_seconds = stats_data.get("total_watch_time_seconds", 0)
                last_updated = stats_data.get("last_updated")

                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == library_id).first()
                if not teacher:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name else f"Library {library_id}")
                    teacher = models.Teacher(name=display_name, bunny_library_id=library_id)
                    db.add(teacher)
                    db.flush()   # assigns the ID without committing

                existing_stat = db.query(models.MonthlyStats).filter(
                    models.MonthlyStats.teacher_id == teacher.id,
                    models.MonthlyStats.month == month,
                    models.MonthlyStats.year == year
                ).first()

                if existing_stat:
                    existing_stat.video_views = views
                    existing_stat.total_watch_time_seconds = watch_time_seconds
                else:
                    db.add(models.MonthlyStats(
                        teacher_id=teacher.id, month=month, year=year,
                        video_views=views, total_watch_time_seconds=watch_time_seconds
                    ))

                synced_libraries.append({"library_id": library_id, "views": views,
                                         "watch_time_seconds": watch_time_seconds, "last_updated": last_updated})
            except Exception as e:
                logger.error(f"Error syncing stats for library {library_id}: {str(e)}")
                continue

        db.commit()
        return {"message": f"Successfully synced statistics for {len(synced_libraries)} libraries",
                "count": len(synced_libraries), "synced_libraries": synced_libraries}

    except Exception as e:
        db.rollback()
        logger.error(f"Error in sync_library_stats: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")

@app.post("/bunny-libraries/raw-api-response/")
async def get_raw_api_response(request: dict, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        library_id = request.get("library_id")
        start_date = request.get("start_date")
        end_date = request.get("end_date")

        if not library_id or not start_date or not end_date:
            raise HTTPException(status_code=400, detail="Missing required parameters")

        import httpx
        BUNNY_STREAM_API_KEY = os.getenv("BUNNY_STREAM_API_KEY")
        if not BUNNY_STREAM_API_KEY:
            raise HTTPException(status_code=500, detail="API key not configured")

        headers = {"AccessKey": BUNNY_STREAM_API_KEY, "Content-Type": "application/json"}
        params = {"dateFrom": start_date, "dateTo": end_date, "hourly": "false"}

        async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
            response = await client.get(
                f"https://video.bunnycdn.com/library/{library_id}/statistics",
                headers=headers, params=params
            )
            if response.status_code == 200:
                return response.json()
            else:
                raise HTTPException(status_code=response.status_code, detail=response.text)

    except Exception as e:
        logger.error(f"Error getting raw API response: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")



@app.get("/users/", response_model=List[schemas.User])
def get_users(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.User).all()


@app.post("/users/", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    db_user = models.User(
        email=user.email, password_hash=hash_password(user.password),
        allowed_pages=user.allowed_pages,
        is_active=user.is_active if user.is_active is not None else True,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.put("/users/{user_id}", response_model=schemas.User)
def update_user(user_id: int, update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if update.email is not None:
        other = db.query(models.User).filter(models.User.email == update.email, models.User.id != user_id).first()
        if other:
            raise HTTPException(status_code=400, detail="Email already in use")
        db_user.email = update.email
    if update.password:
        db_user.password_hash = hash_password(update.password)
    if update.allowed_pages is not None:
        db_user.allowed_pages = update.allowed_pages
    if update.is_active is not None:
        db_user.is_active = update.is_active
    db.commit()
    db.refresh(db_user)
    return db_user


@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(db_user)
    db.commit()
    return {"success": True}


@app.post("/auth/login", response_model=schemas.LoginResponse)
def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user or not user.is_active or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    access_token = create_access_token(data={"sub": str(user.id)})
    
    return schemas.LoginResponse(
        success=True, message="Login successful",
        user_id=user.id, email=user.email, allowed_pages=user.allowed_pages or [],
        access_token=access_token, token_type="bearer"
    )

# ============================================
# LIBRARY CONFIGURATIONS
# ============================================

@app.get("/library-configs/", response_model=List[schemas.LibraryConfig])
def get_library_configs(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.LibraryConfig).all()


@app.get("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def get_library_config(library_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    return config


@app.post("/library-configs/", response_model=schemas.LibraryConfig)
def create_library_config(config: schemas.LibraryConfigCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    existing_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == config.library_id).first()
    if existing_config:
        existing_config.library_name = config.library_name
        existing_config.stream_api_key = config.stream_api_key
        existing_config.is_active = config.is_active
        existing_config.updated_at = datetime.now()
        db.commit()
        db.refresh(existing_config)
        return existing_config
    else:
        db_config = models.LibraryConfig(**config.dict())
        db.add(db_config)
        db.commit()
        db.refresh(db_config)
        return db_config

@app.put("/library-configs/{library_id}", response_model=schemas.LibraryConfig)
def update_library_config(library_id: int, config: schemas.LibraryConfigUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail=f"Library configuration not found for library_id {library_id}")

    logger.info("=" * 60)
    logger.info(f"UPDATE CONFIG - Library ID: {library_id}")

    update_data = config.dict(exclude_unset=True)

    if 'stream_api_key' in update_data and update_data['stream_api_key']:
        original_key = str(update_data['stream_api_key']).strip()
        update_data['stream_api_key'] = original_key
        logger.info(f"Received API Key Length: {len(original_key)}")

    for field, value in update_data.items():
        setattr(db_config, field, value)

    db_config.updated_at = datetime.utcnow()

    try:
        db.commit()
        db.refresh(db_config)
    except Exception as e:
        db.rollback()
        logger.error(f"❌ Database commit failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save configuration: {str(e)}")

    logger.info(f"✅ Configuration saved successfully")
    logger.info("=" * 60)

    return db_config


@app.delete("/library-configs/{library_id}")
def delete_library_config(library_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_config = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
    if not db_config:
        raise HTTPException(status_code=404, detail="Library configuration not found")
    db.delete(db_config)
    db.commit()
    return {"message": "Library configuration deleted successfully"}


@app.post("/library-configs/sync-from-bunny/")
async def sync_library_configs_from_bunny(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()
        logger.info(f"Fetched {len(libraries)} libraries from Bunny.net API")

        synced_count = 0
        updated_count = 0

        from database import engine
        from sqlalchemy import text as sql_text

        with engine.begin() as conn:
            for library in libraries:
                lib_id = library.get("id") if "id" in library else library.get("Id")
                lib_name = library.get("name") if "name" in library else library.get("Name")

                if lib_id is None:
                    logger.warning(f"Skipping library with null ID: {library}")
                    continue
                try:
                    lib_id = int(lib_id)
                except (TypeError, ValueError):
                    logger.warning(f"Skipping library with non-integer ID '{lib_id}': {library}")
                    continue
                if not lib_name:
                    lib_name = f"Library {lib_id}"
                lib_name = str(lib_name)

                result = conn.execute(
                    sql_text(
                        "INSERT INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                        "VALUES (:library_id, :library_name, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                        "ON CONFLICT (library_id) DO UPDATE SET "
                        "library_name = EXCLUDED.library_name, "
                        "updated_at = CURRENT_TIMESTAMP "
                        "WHERE library_configs.library_name != EXCLUDED.library_name"
                    ),
                    {"library_id": lib_id, "library_name": lib_name}
                )
                if result.rowcount:
                    updated_count += 1
                else:
                    synced_count += 1

            stats_rows = conn.execute(
                sql_text("SELECT DISTINCT library_id, library_name FROM library_historical_stats")
            ).fetchall()

            for row in stats_rows:
                hist_id = row[0]
                hist_name = row[1]
                if hist_id is None:
                    continue
                try:
                    hist_id = int(hist_id)
                except (TypeError, ValueError):
                    continue
                hist_name = str(hist_name or f"Library {hist_id}")

                conn.execute(
                    sql_text(
                        "INSERT INTO library_configs (library_id, library_name, stream_api_key, is_active, created_at, updated_at) "
                        "VALUES (:library_id, :library_name, NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) "
                        "ON CONFLICT (library_id) DO NOTHING"
                    ),
                    {"library_id": hist_id, "library_name": hist_name}
                )
                synced_count += 1

        return {"message": f"Sync complete: created {synced_count}, updated {updated_count}",
                "created": synced_count, "updated": updated_count}

    except Exception as e:
        logger.error(f"Error syncing library configs: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to sync library configurations: {str(e)}")


# ============================================
# ROOT
# ============================================

@app.get("/")
def read_root():
    return {"message": "Welcome to Elkheta Teacher Performance Dashboard API"}


# ============================================
# HISTORICAL STATS
# ============================================

@app.post("/historical-stats/batch-fetch/", response_model=schemas.BatchFetchResponse)
async def batch_fetch_library_stats(request: schemas.BatchFetchRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        results = []
        successful_fetches = 0
        failed_fetches = 0
        skipped_fetches = 0

        for library_id in request.library_ids:
            try:
                existing_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == library_id,
                    models.LibraryHistoricalStats.month == request.month,
                    models.LibraryHistoricalStats.year == request.year
                ).first()

                stats_data = await get_library_monthly_stats(library_id, request.month, request.year, db)

                try:
                    cfg = db.query(models.LibraryConfig).filter(models.LibraryConfig.library_id == library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name
                                    else stats_data.get("library_name", f"Library {library_id}"))
                except Exception:
                    display_name = stats_data.get("library_name", f"Library {library_id}")

                if existing_stats:
                    existing_stats.total_views = stats_data.get("total_views", 0)
                    existing_stats.total_watch_time_seconds = stats_data.get("total_watch_time_seconds", 0)
                    existing_stats.bandwidth_gb = stats_data.get("bandwidth_gb", 0.0)
                    existing_stats.views_chart = stats_data.get("views_chart", {})
                    existing_stats.watch_time_chart = stats_data.get("watch_time_chart", {})
                    existing_stats.bandwidth_chart = stats_data.get("bandwidth_chart", {})
                    existing_stats.library_name = display_name
                    existing_stats.fetch_date = datetime.now(pytz.UTC)
                    existing_stats.updated_at = datetime.now(pytz.UTC)
                    db.commit()
                    db.refresh(existing_stats)
                    results.append(schemas.LibraryFetchStatus(
                        library_id=library_id, library_name=display_name,
                        status="success", success=True, message="Updated existing data", data=existing_stats
                    ))
                else:
                    new_stats = models.LibraryHistoricalStats(
                        library_id=library_id, library_name=display_name,
                        month=request.month, year=request.year,
                        total_views=stats_data.get("total_views", 0),
                        total_watch_time_seconds=stats_data.get("total_watch_time_seconds", 0),
                        bandwidth_gb=stats_data.get("bandwidth_gb", 0.0),
                        views_chart=stats_data.get("views_chart", {}),
                        watch_time_chart=stats_data.get("watch_time_chart", {}),
                        bandwidth_chart=stats_data.get("bandwidth_chart", {}),
                        fetch_date=datetime.now(pytz.UTC), is_synced=False
                    )
                    db.add(new_stats)
                    db.commit()
                    db.refresh(new_stats)
                    results.append(schemas.LibraryFetchStatus(
                        library_id=library_id, library_name=display_name,
                        status="success", success=True, message="Fetched new data", data=new_stats
                    ))

                successful_fetches += 1

            except Exception as e:
                logger.error(f"Failed to fetch stats for library {library_id}: {str(e)}")
                results.append(schemas.LibraryFetchStatus(
                    library_id=library_id, library_name=f"Library {library_id}",
                    status="error", success=False, message=f"Failed to fetch: {str(e)}", error=str(e)
                ))
                failed_fetches += 1

        return schemas.BatchFetchResponse(
            success=successful_fetches > 0,
            message=f"Fetched stats for {successful_fetches}/{len(request.library_ids)} libraries",
            total_libraries=len(request.library_ids),
            successful_fetches=successful_fetches, failed_fetches=failed_fetches,
            skipped_fetches=skipped_fetches, results=results
        )

    except Exception as e:
        logger.error(f"Batch fetch error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")



@app.post("/historical-stats/sync/", response_model=schemas.SyncResponse)
async def sync_historical_stats(request: schemas.SyncRequest, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        logger.info("=" * 60)
        logger.info("SYNC TO LIBRARIES PAGE - REQUEST RECEIVED")
        logger.info(f"Library IDs: {request.library_ids}, Month: {request.month}, Year: {request.year}")
        logger.info("=" * 60)

        results = []
        synced_libraries = 0
        failed_syncs = 0
        already_synced = 0

        query = db.query(models.LibraryHistoricalStats)
        if request.library_ids:
            query = query.filter(
                models.LibraryHistoricalStats.library_id.in_(request.library_ids),
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year
            )
        else:
            query = query.filter(
                models.LibraryHistoricalStats.month == request.month,
                models.LibraryHistoricalStats.year == request.year,
                models.LibraryHistoricalStats.is_synced == False
            )

        stats_to_sync = query.all()

        if len(stats_to_sync) == 0:
            logger.warning("NO STATS FOUND TO SYNC!")
            if request.library_ids:
                any_stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id.in_(request.library_ids)
                ).all()
                if len(any_stats) == 0:
                    raise HTTPException(status_code=404,
                        detail=f"No stats found for libraries {request.library_ids}. Please fetch stats first.")
                else:
                    available_periods = list(set([(s.month, s.year) for s in any_stats]))
                    raise HTTPException(status_code=404,
                        detail=f"No stats found for month={request.month}, year={request.year}. Available: {available_periods}")
            else:
                raise HTTPException(status_code=404,
                    detail=f"No unsynced stats found for month={request.month}, year={request.year}.")

        logger.info(f"Found {len(stats_to_sync)} stats to sync")

        for stats in stats_to_sync:
            try:
                stats.is_synced = True
                stats.sync_date = datetime.now(pytz.UTC)
                stats.updated_at = datetime.now(pytz.UTC)

                try:
                    teacher = db.query(models.Teacher).filter(
                        models.Teacher.bunny_library_id == stats.library_id).first()
                    cfg = db.query(models.LibraryConfig).filter(
                        models.LibraryConfig.library_id == stats.library_id).first()
                    display_name = (cfg.library_name if cfg and cfg.library_name
                                    else stats.library_name or f"Library {stats.library_id}")
                    if teacher:
                        if teacher.name != display_name:
                            logger.info(f"Updating teacher name: {teacher.name} → {display_name}")
                            teacher.name = display_name
                    else:
                        logger.info(f"Creating new teacher: {display_name}")
                        db.add(models.Teacher(name=display_name, bunny_library_id=stats.library_id))
                except Exception as teacher_err:
                    logger.error(f"Teacher upsert failed for library {stats.library_id}: {str(teacher_err)}")

                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id, library_name=stats.library_name,
                    status="synced", success=True,
                    message=f"Synced successfully - {stats.total_views} views, {stats.total_watch_time_seconds} seconds"
                ))
                synced_libraries += 1
                logger.info(f"✓ Synced library {stats.library_id}: {stats.library_name}")

            except Exception as e:
                logger.error(f"Failed to sync library {stats.library_id}: {str(e)}")
                results.append(schemas.LibrarySyncStatus(
                    library_id=stats.library_id, library_name=stats.library_name,
                    status="error", success=False, message=f"Sync failed: {str(e)}", error=str(e)
                ))
                failed_syncs += 1

        db.commit()
        logger.info(f"SYNC COMPLETE - synced: {synced_libraries}, failed: {failed_syncs}")

        return schemas.SyncResponse(
            success=synced_libraries > 0,
            message=f"Synced {synced_libraries} libraries to Libraries page",
            total_libraries=len(stats_to_sync),
            synced_libraries=synced_libraries, failed_syncs=failed_syncs,
            already_synced=already_synced, results=results
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Sync error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/historical-stats/libraries/", response_model=List[schemas.LibraryWithHistory])
async def get_libraries_with_history(with_stats_only: bool = False, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries_query = db.query(
            models.LibraryHistoricalStats.library_id,
            models.LibraryHistoricalStats.library_name
        ).distinct()

        if with_stats_only:
            libraries_query = libraries_query.filter(models.LibraryHistoricalStats.is_synced == True)

        unique_libraries = libraries_query.all()

        if not unique_libraries and not with_stats_only:
            bunny_libraries = await get_bunny_libraries()
            return [schemas.LibraryWithHistory(
                library_id=lib.get("id"), library_name=lib.get("name"),
                has_stats=False, monthly_data=[], last_updated=None
            ) for lib in bunny_libraries]

        config_names = {cfg.library_id: cfg.library_name for cfg in db.query(models.LibraryConfig).all()}

        result = []
        for lib_id, lib_name in unique_libraries:
            try:
                teacher = db.query(models.Teacher).filter(models.Teacher.bunny_library_id == lib_id).first()
                preferred_name = config_names.get(lib_id) or lib_name
                if teacher:
                    if preferred_name and teacher.name != preferred_name:
                        teacher.name = preferred_name
                else:
                    db.add(models.Teacher(name=preferred_name or f"Library {lib_id}", bunny_library_id=lib_id))
                db.flush()
            except Exception as upsert_err:
                logger.error(f"Teacher upsert during history retrieval failed for library {lib_id}: {str(upsert_err)}")

            monthly_stats = db.query(models.LibraryHistoricalStats).filter(
                models.LibraryHistoricalStats.library_id == lib_id
            ).order_by(
                models.LibraryHistoricalStats.year.desc(),
                models.LibraryHistoricalStats.month.desc()
            ).all()

            monthly_data = []
            last_updated = None
            latest_name = lib_name

            for stats in monthly_stats:
                monthly_data.append(schemas.MonthlyData(
                    month=stats.month, year=stats.year,
                    total_views=stats.total_views,
                    total_watch_time_seconds=stats.total_watch_time_seconds,
                    bandwidth_gb=stats.bandwidth_gb, fetch_date=stats.fetch_date
                ))
                if not last_updated or stats.fetch_date > last_updated:
                    last_updated = stats.fetch_date
                    if stats.library_name:
                        latest_name = stats.library_name

            result.append(schemas.LibraryWithHistory(
                library_id=lib_id,
                library_name=config_names.get(lib_id) or latest_name or lib_name or f"Library {lib_id}",
                has_stats=len(monthly_data) > 0,
                monthly_data=monthly_data, last_updated=last_updated
            ))

        return result

    except Exception as e:
        logger.error(f"Get libraries with history error: {str(e)}")
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


# ============================================
# STAGE ENDPOINTS
# ============================================

@app.get("/stages/")
def get_stages(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    stages = db.query(Stage).order_by(Stage.display_order).all()
    return [{"id": s.id, "code": s.code, "name": s.name, "display_order": s.display_order,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in stages]


@app.post("/stages/")
def create_stage(stage: StageCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        logger.info(f"Creating stage with data: {stage.dict()}")
        existing = db.query(Stage).filter(Stage.code == stage.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Stage with code {stage.code} already exists")
        db_stage = Stage(**stage.dict())
        db.add(db_stage)
        db.commit()
        db.refresh(db_stage)
        logger.info(f"Stage created successfully: {db_stage.id}")
        return {"id": db_stage.id, "code": db_stage.code, "name": db_stage.name,
                "display_order": db_stage.display_order,
                "created_at": db_stage.created_at.isoformat() if db_stage.created_at else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating stage: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create stage: {str(e)}")


@app.put("/stages/{stage_id}")
def update_stage(stage_id: int, stage: StageUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    for field, value in stage.dict(exclude_unset=True).items():
        setattr(db_stage, field, value)
    db.commit()
    db.refresh(db_stage)
    return {"id": db_stage.id, "code": db_stage.code, "name": db_stage.name,
            "display_order": db_stage.display_order,
            "created_at": db_stage.created_at.isoformat() if db_stage.created_at else None}


@app.delete("/stages/{stage_id}")
def delete_stage(stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_stage = db.query(Stage).filter(Stage.id == stage_id).first()
    if not db_stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    db.delete(db_stage)
    db.commit()
    return {"message": "Stage deleted successfully"}


# ============================================
# SECTION ENDPOINTS
# ============================================

@app.get("/sections/")
def get_sections(stage_id: int = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = db.query(Section)
    if stage_id:
        query = query.filter(Section.stage_id == stage_id)
    sections = query.all()
    return [{"id": s.id, "stage_id": s.stage_id, "code": s.code, "name": s.name,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in sections]


@app.post("/sections/")
def create_section(section: SectionCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        db_section = Section(**section.dict())
        db.add(db_section)
        db.commit()
        db.refresh(db_section)
        return {"id": db_section.id, "stage_id": db_section.stage_id, "code": db_section.code,
                "name": db_section.name,
                "created_at": db_section.created_at.isoformat() if db_section.created_at else None}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.delete("/sections/{section_id}")
def delete_section(section_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_section = db.query(Section).filter(Section.id == section_id).first()
    if not db_section:
        raise HTTPException(status_code=404, detail="Section not found")
    db.delete(db_section)
    db.commit()
    return {"message": "Section deleted successfully"}


# ============================================
# SUBJECT ENDPOINTS
# ============================================

@app.get("/subjects/")
def get_subjects(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    subjects = db.query(Subject).all()
    return [{"id": s.id, "code": s.code, "name": s.name, "is_common": s.is_common,
             "created_at": s.created_at.isoformat() if s.created_at else None} for s in subjects]


@app.post("/subjects/")
def create_subject(subject: SubjectCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(Subject).filter(Subject.code == subject.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Subject with code {subject.code} already exists")
        db_subject = Subject(**subject.dict())
        db.add(db_subject)
        db.commit()
        db.refresh(db_subject)
        return {"id": db_subject.id, "code": db_subject.code, "name": db_subject.name,
                "is_common": db_subject.is_common,
                "created_at": db_subject.created_at.isoformat() if db_subject.created_at else None}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.delete("/subjects/{subject_id}")
def delete_subject(subject_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not db_subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    db.delete(db_subject)
    db.commit()
    return {"message": "Subject deleted successfully"}


# ============================================
# TEACHER ASSIGNMENT ENDPOINTS
# ============================================

@app.get("/teacher-assignments/", response_model=List[TeacherAssignmentWithDetails])
def get_teacher_assignments(stage_id: int = None, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    from sqlalchemy.orm import joinedload
    query = db.query(TeacherAssignment).options(
        joinedload(TeacherAssignment.stage),
        joinedload(TeacherAssignment.section),
        joinedload(TeacherAssignment.subject),
    )
    if stage_id:
        query = query.filter(TeacherAssignment.stage_id == stage_id)
    assignments = query.all()
    result = []
    for assignment in assignments:
        result.append(TeacherAssignmentWithDetails(**{
            "id": assignment.id,
            "library_id": assignment.library_id,
            "library_name": assignment.library_name,
            "stage_id": assignment.stage_id,
            "section_id": assignment.section_id,
            "subject_id": assignment.subject_id,
            "tax_rate": assignment.tax_rate,
            "revenue_percentage": assignment.revenue_percentage,
            "created_at": assignment.created_at,
            "updated_at": assignment.updated_at,
            "stage_name": assignment.stage.name if assignment.stage else None,
            "section_name": assignment.section.name if assignment.section else None,
            "subject_name": assignment.subject.name if assignment.subject else None,
            "subject_is_common": assignment.subject.is_common if assignment.subject else None,
        }))
    return result

# ============================================
# SERIALIZER HELPERS
# ============================================

def _stage_to_dict(obj) -> dict:
    return {
        "id":            obj.id,
        "code":          obj.code,
        "name":          obj.name,
        "display_order": obj.display_order,
        "created_at":    obj.created_at,
    }


def _section_to_dict(obj) -> dict:
    return {
        "id":         obj.id,
        "stage_id":   obj.stage_id,
        "code":       obj.code,
        "name":       obj.name,
        "created_at": obj.created_at,
    }


def _section_revenue_with_details_to_dict(obj, stage_name, section_name) -> dict:
    return {
        "id":                obj.id,
        "period_id":         obj.period_id,
        "stage_id":          obj.stage_id,
        "section_id":        obj.section_id,
        "total_orders":      obj.total_orders,
        "total_revenue_egp": obj.total_revenue_egp,
        "created_at":        obj.created_at,
        "updated_at":        obj.updated_at,
        "stage_name":        stage_name,
        "section_name":      section_name,
    }


def _assignment_with_details_to_dict(obj, stage_name, section_name, subject_name, subject_is_common) -> dict:
    return {
        "id":                 obj.id,
        "library_id":         obj.library_id,
        "library_name":       obj.library_name,
        "stage_id":           obj.stage_id,
        "section_id":         obj.section_id,
        "subject_id":         obj.subject_id,
        "tax_rate":           obj.tax_rate,
        "revenue_percentage": obj.revenue_percentage,
        "created_at":         obj.created_at,
        "updated_at":         obj.updated_at,
        "stage_name":         stage_name,
        "section_name":       section_name,
        "subject_name":       subject_name,
        "subject_is_common":  subject_is_common,
    }


def _payment_with_details_to_dict(obj, stage_name, section_name, subject_name, subject_is_common) -> dict:
    return {
        "id":                          obj.id,
        "period_id":                   obj.period_id,
        "assignment_id":               obj.assignment_id,
        "library_id":                  obj.library_id,
        "library_name":                obj.library_name,
        "stage_id":                    obj.stage_id,
        "section_id":                  obj.section_id,
        "subject_id":                  obj.subject_id,
        "total_watch_time_seconds":    obj.total_watch_time_seconds,
        "watch_time_percentage":       obj.watch_time_percentage,
        "monthly_watch_breakdown":     obj.monthly_watch_breakdown or {},
        "section_total_orders":        obj.section_total_orders,
        "section_order_percentage":    obj.section_order_percentage,
        "base_revenue":                obj.base_revenue,
        "revenue_percentage_applied":  obj.revenue_percentage_applied,
        "calculated_revenue":          obj.calculated_revenue,
        "tax_rate_applied":            obj.tax_rate_applied,
        "tax_amount":                  obj.tax_amount,
        "final_payment":               obj.final_payment,
        "created_at":                  obj.created_at,
        "stage_name":                  stage_name,
        "section_name":                section_name,
        "subject_name":                subject_name,
        "subject_is_common":           subject_is_common,
    }


def _period_to_dict(obj) -> dict:
    return {
        "id":         obj.id,
        "name":       obj.name,
        "year":       obj.year,
        "notes":      obj.notes,
        "months":     obj.months or [],
        "created_at": obj.created_at,
    }


def _revenue_to_dict(obj) -> dict:
    return {
        "id":                obj.id,
        "period_id":         obj.period_id,
        "stage_id":          obj.stage_id,
        "section_id":        obj.section_id,
        "total_orders":      obj.total_orders,
        "total_revenue_egp": obj.total_revenue_egp,
        "created_at":        obj.created_at,
        "updated_at":        obj.updated_at,
    }


def _assignment_to_dict(obj) -> dict:
    return {
        "id":                 obj.id,
        "library_id":         obj.library_id,
        "library_name":       obj.library_name,
        "stage_id":           obj.stage_id,
        "section_id":         obj.section_id,
        "subject_id":         obj.subject_id,
        "tax_rate":           obj.tax_rate,
        "revenue_percentage": obj.revenue_percentage,
        "created_at":         obj.created_at,
        "updated_at":         obj.updated_at,
    }


@app.post("/teacher-assignments/", response_model=TeacherAssignmentSchema)
def create_teacher_assignment(assignment: TeacherAssignmentCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        q = db.query(TeacherAssignment).filter(
            TeacherAssignment.library_id == assignment.library_id,
            TeacherAssignment.stage_id   == assignment.stage_id,
            TeacherAssignment.subject_id == assignment.subject_id,
        )
        if assignment.section_id is None:
            q = q.filter(TeacherAssignment.section_id.is_(None))
        else:
            q = q.filter(TeacherAssignment.section_id == assignment.section_id)

        existing = q.first()

        if existing:
            changed = False
            if assignment.tax_rate != existing.tax_rate:
                existing.tax_rate = assignment.tax_rate
                changed = True
            if assignment.revenue_percentage != existing.revenue_percentage:
                existing.revenue_percentage = assignment.revenue_percentage
                changed = True
            if changed:
                existing.updated_at = datetime.now(pytz.UTC)
                db.commit()
                db.refresh(existing)
            return _assignment_to_dict(existing)

        db_assignment = TeacherAssignment(**assignment.dict())
        db.add(db_assignment)
        db.commit()
        db.refresh(db_assignment)
        return _assignment_to_dict(db_assignment)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_teacher_assignment: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create assignment: {str(e)}")


@app.put("/teacher-assignments/{assignment_id}", response_model=TeacherAssignmentSchema)
def update_teacher_assignment(assignment_id: int, assignment: TeacherAssignmentUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_obj = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_obj:
        raise HTTPException(status_code=404, detail="Assignment not found")
    for field, value in assignment.dict(exclude_unset=True).items():
        setattr(db_obj, field, value)
    db_obj.updated_at = datetime.now(pytz.UTC)
    db.commit()
    db.refresh(db_obj)
    return db_obj


@app.delete("/teacher-assignments/{assignment_id}")
def delete_teacher_assignment(assignment_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_assignment = db.query(TeacherAssignment).filter(TeacherAssignment.id == assignment_id).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(db_assignment)
    db.commit()
    return {"message": "Assignment deleted successfully"}


@app.post("/teacher-assignments/auto-match", response_model=AutoMatchResponse)
async def auto_match_teachers(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        libraries = await get_bunny_libraries()

        stages_by_code   = {s.code: s for s in db.query(Stage).all()}
        subjects_by_code = {s.code: s for s in db.query(Subject).all()}
        sections_lookup  = {
            (sec.stage_id, sec.code): sec
            for sec in db.query(Section).all()
        }
        sections_by_stage = {}
        for (sid, _), sec in sections_lookup.items():
            sections_by_stage.setdefault(sid, []).append(sec)

        results       = []
        matched_count = 0
        unmatched_count = 0

        for lib in libraries:
            lib_id   = lib.get("id")
            lib_name = lib.get("name", "")

            if not lib_id:
                unmatched_count += 1
                continue

            stage_code, section_code, subject_code = parse_library_name(lib_name)

            if not stage_code or not subject_code:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Could not parse: stage={stage_code}, subject={subject_code}"
                ))
                unmatched_count += 1
                continue

            stage = stages_by_code.get(stage_code)
            if not stage:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Stage '{stage_code}' not found – add it in Settings → Stages"
                ))
                unmatched_count += 1
                continue

            subject = subjects_by_code.get(subject_code)
            if not subject:
                for code, subj in subjects_by_code.items():
                    if code.upper() == subject_code.upper():
                        subject = subj
                        break
            if not subject:
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=False,
                    message=f"Subject '{subject_code}' not found – add it in Settings → Subjects"
                ))
                unmatched_count += 1
                continue

            if subject.is_common or section_code is None:
                stage_sections = sections_by_stage.get(stage.id, [])

                if not stage_sections:
                    existing = db.query(TeacherAssignment).filter(
                        TeacherAssignment.library_id == lib_id,
                        TeacherAssignment.stage_id   == stage.id,
                        TeacherAssignment.subject_id  == subject.id,
                        TeacherAssignment.section_id  == None,
                    ).first()
                    if not existing:
                        db.add(TeacherAssignment(
                            library_id=lib_id, library_name=lib_name,
                            stage_id=stage.id, section_id=None,
                            subject_id=subject.id,
                            tax_rate=0.0, revenue_percentage=0.95,
                        ))
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code="NONE_YET",
                        subject_code=subject_code, matched=True,
                        message="Common – no sections defined for this stage yet"
                    ))
                else:
                    assigned_to = []
                    for sec in stage_sections:
                        existing = db.query(TeacherAssignment).filter(
                            TeacherAssignment.library_id == lib_id,
                            TeacherAssignment.stage_id   == stage.id,
                            TeacherAssignment.subject_id  == subject.id,
                            TeacherAssignment.section_id  == sec.id,
                        ).first()
                        if not existing:
                            db.add(TeacherAssignment(
                                library_id=lib_id, library_name=lib_name,
                                stage_id=stage.id, section_id=sec.id,
                                subject_id=subject.id,
                                tax_rate=0.0, revenue_percentage=0.95,
                            ))
                        assigned_to.append(sec.code)
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code="BOTH",
                        subject_code=subject_code, matched=True,
                        message=f"Common subject → assigned to: {', '.join(assigned_to)}"
                    ))
                matched_count += 1

            else:
                section = sections_lookup.get((stage.id, section_code))
                if not section:
                    results.append(AutoMatchResult(
                        library_id=lib_id, library_name=lib_name,
                        stage_code=stage_code, section_code=section_code,
                        subject_code=subject_code, matched=False,
                        message=(
                            f"Section '{section_code}' not found for stage '{stage_code}' – "
                            f"add it in Settings → Sections"
                        )
                    ))
                    unmatched_count += 1
                    continue

                existing = db.query(TeacherAssignment).filter(
                    TeacherAssignment.library_id == lib_id,
                    TeacherAssignment.stage_id   == stage.id,
                    TeacherAssignment.subject_id  == subject.id,
                    TeacherAssignment.section_id  == section.id,
                ).first()
                if not existing:
                    db.add(TeacherAssignment(
                        library_id=lib_id, library_name=lib_name,
                        stage_id=stage.id, section_id=section.id,
                        subject_id=subject.id,
                        tax_rate=0.0, revenue_percentage=0.95,
                    ))
                results.append(AutoMatchResult(
                    library_id=lib_id, library_name=lib_name,
                    stage_code=stage_code, section_code=section_code,
                    subject_code=subject_code, matched=True,
                    message=f"Matched to section {section_code} ({section.name})"
                ))
                matched_count += 1

        db.commit()
        logger.info(f"Auto-match: {matched_count} matched, {unmatched_count} unmatched from {len(libraries)} libraries")

        return AutoMatchResponse(
            total_libraries=len(libraries),
            matched=matched_count,
            unmatched=unmatched_count,
            results=results,
        )

    except Exception as e:
        db.rollback()
        logger.error(f"Auto-match error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


# ============================================
# FINANCIAL PERIOD ENDPOINTS
# ============================================

@app.get("/financial-periods/", response_model=List[FinancialPeriodSchema])
def get_financial_periods(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    periods = db.query(FinancialPeriod).order_by(
        FinancialPeriod.year.desc(), FinancialPeriod.created_at.desc()
    ).all()
    return [_period_to_dict(p) for p in periods]


@app.post("/financial-periods/", response_model=FinancialPeriodSchema)
def create_financial_period(period: FinancialPeriodCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(FinancialPeriod).filter(
            FinancialPeriod.name == period.name
        ).first()

        if existing:
            return _period_to_dict(existing)

        db_period = FinancialPeriod(**period.dict())
        db.add(db_period)
        db.commit()
        db.refresh(db_period)
        return _period_to_dict(db_period)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_financial_period: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create period: {str(e)}")


@app.put("/financial-periods/{period_id}", response_model=FinancialPeriodSchema)
def update_financial_period(period_id: int, period: FinancialPeriodUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        db_period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not db_period:
            raise HTTPException(status_code=404, detail="Period not found")
        for field, value in period.dict(exclude_unset=True).items():
            setattr(db_period, field, value)
        db.commit()
        db.refresh(db_period)
        return _period_to_dict(db_period)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error in update_financial_period: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update period: {str(e)}")


@app.delete("/financial-periods/{period_id}")
def delete_financial_period(period_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
    if not db_period:
        raise HTTPException(status_code=404, detail="Period not found")
    db.delete(db_period)
    db.commit()
    return {"message": "Period deleted successfully"}


# ============================================
# SECTION REVENUE ENDPOINTS
# ============================================

@app.post("/section-revenues/", response_model=SectionRevenueSchema)
def create_or_update_section_revenue(revenue: SectionRevenueCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        existing = db.query(SectionRevenue).filter(
            SectionRevenue.period_id  == revenue.period_id,
            SectionRevenue.stage_id   == revenue.stage_id,
            SectionRevenue.section_id == revenue.section_id,
        ).first()

        if existing:
            existing.total_orders      = revenue.total_orders
            existing.total_revenue_egp = revenue.total_revenue_egp
            existing.updated_at        = datetime.now(pytz.UTC)
            db.commit()
            db.refresh(existing)
            return _revenue_to_dict(existing)

        db_revenue = SectionRevenue(**revenue.dict())
        db.add(db_revenue)
        db.commit()
        db.refresh(db_revenue)
        return _revenue_to_dict(db_revenue)

    except Exception as e:
        db.rollback()
        logger.error(f"Error in create_or_update_section_revenue: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save revenue: {str(e)}")


# ============================================
# FINANCIAL DATA & CALCULATION ENDPOINTS
# ============================================

@app.get("/financials/{period_id}/{stage_id}", response_model=FinancialData)
def get_financial_data(period_id: int, stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    try:
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        stage = db.query(Stage).filter(Stage.id == stage_id).first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")

        sections = db.query(Section).filter(Section.stage_id == stage_id).all()
        section_map = {s.id: s for s in sections}

        section_revenues_raw = db.query(SectionRevenue).filter(
            SectionRevenue.period_id == period_id,
            SectionRevenue.stage_id  == stage_id,
        ).all()
        section_revenues_dicts = [
            _section_revenue_with_details_to_dict(
                rev,
                stage_name=stage.name,
                section_name=section_map[rev.section_id].name if rev.section_id in section_map else None,
            )
            for rev in section_revenues_raw
        ]

        assignments_raw = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()
        subject_cache = {}
        def get_subject(subject_id):
            if subject_id not in subject_cache:
                subject_cache[subject_id] = db.query(Subject).filter(Subject.id == subject_id).first()
            return subject_cache[subject_id]

        assignments_dicts = []
        for a in assignments_raw:
            sec = section_map.get(a.section_id) if a.section_id else None
            subj = get_subject(a.subject_id)
            assignments_dicts.append(_assignment_with_details_to_dict(
                a,
                stage_name=stage.name,
                section_name=sec.name if sec else None,
                subject_name=subj.name if subj else None,
                subject_is_common=subj.is_common if subj else None,
            ))

        payments_raw = db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).all()
        payments_dicts = []
        for p in payments_raw:
            sec = section_map.get(p.section_id) if p.section_id else None
            subj = get_subject(p.subject_id)
            payments_dicts.append(_payment_with_details_to_dict(
                p,
                stage_name=stage.name,
                section_name=sec.name if sec else None,
                subject_name=subj.name if subj else None,
                subject_is_common=subj.is_common if subj else None,
            ))

        return FinancialData(
            period=_period_to_dict(period),
            stage=_stage_to_dict(stage),
            sections=[_section_to_dict(s) for s in sections],
            section_revenues=[SectionRevenueWithDetails(**d) for d in section_revenues_dicts],
            teacher_assignments=[TeacherAssignmentWithDetails(**d) for d in assignments_dicts],
            teacher_payments=[TeacherPaymentWithDetails(**d) for d in payments_dicts],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_financial_data: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to load financial data: {str(e)}")


@app.get("/financials/{period_id}/{stage_id}/libraries-preview")
def get_libraries_preview(period_id: int, stage_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    """
    Returns all assigned libraries for this stage with their watch time
    broken down per period month. Libraries with zero analytics are flagged.
    """
    try:
        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        period_months = period.months or []

        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()

        subject_cache = {}
        def get_subject(subject_id):
            if subject_id not in subject_cache:
                subject_cache[subject_id] = db.query(Subject).filter(Subject.id == subject_id).first()
            return subject_cache[subject_id]

        section_cache = {}
        def get_section(section_id):
            if section_id not in section_cache:
                section_cache[section_id] = db.query(Section).filter(Section.id == section_id).first()
            return section_cache[section_id]

        libraries = []
        seen = set()

        for a in assignments:
            key = (a.library_id, a.section_id)
            if key in seen:
                continue
            seen.add(key)

            subj = get_subject(a.subject_id)
            sec  = get_section(a.section_id) if a.section_id else None

            monthly_breakdown = {}
            total_seconds = 0

            for month_str in period_months:
                try:
                    year, month = map(int, month_str.split("-"))
                except ValueError:
                    continue
                stat = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == a.library_id,
                    models.LibraryHistoricalStats.year  == year,
                    models.LibraryHistoricalStats.month == month,
                ).first()
                secs = stat.total_watch_time_seconds if stat else 0
                monthly_breakdown[month_str] = secs
                total_seconds += secs

            libraries.append({
                "library_id":               a.library_id,
                "library_name":             a.library_name,
                "subject_name":             subj.name if subj else None,
                "subject_is_common":        subj.is_common if subj else False,
                "section_name":             sec.name if sec else "All Sections",
                "total_watch_time_seconds": total_seconds,
                "monthly_watch_breakdown":  monthly_breakdown,
                "has_analytics":            total_seconds > 0,
            })

        no_analytics_count = sum(1 for lib in libraries if not lib["has_analytics"])

        return {
            "period_months":      period_months,
            "libraries":          libraries,
            "no_analytics_count": no_analytics_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_libraries_preview: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")


@app.post("/calculate-payments/{period_id}/{stage_id}", response_model=CalculatePaymentsResponse)
async def calculate_payments(
    period_id: int,
    stage_id: int,
    request: dict = None,
    db: Session = Depends(get_db),
):
    """
    Payment calculation — correct algorithm:

    STEP 1 — Allocate common subject watch time per section:
      Each common library has ONE assignment per section (created by auto-match).
      For that assignment's section:
        allocated_wt = raw_wt * (section_orders / total_all_orders)
      This is the "virtual" split proportional to orders.

    STEP 2 — Build each section's total watch time pool:
      pool[section] = Σ allocated_wt (common libs) + Σ raw_wt (specific libs)

    STEP 3 — Compute payment for each teacher:
      watch_pct = teacher_effective_wt / section_pool
      payment   = section_revenue * watch_pct * revenue_pct * (1 - tax_rate)
    """
    try:
        excluded_ids = []
        if request and isinstance(request, dict):
            excluded_ids = request.get("excluded_library_ids", [])

        period = db.query(FinancialPeriod).filter(FinancialPeriod.id == period_id).first()
        if not period:
            raise HTTPException(status_code=404, detail="Period not found")

        stage = db.query(Stage).filter(Stage.id == stage_id).first()
        if not stage:
            raise HTTPException(status_code=404, detail="Stage not found")

        period_months = period.months or []

        section_revenues = db.query(SectionRevenue).filter(
            SectionRevenue.period_id == period_id,
            SectionRevenue.stage_id  == stage_id,
        ).all()
        if not section_revenues:
            raise HTTPException(status_code=400, detail="No revenue data found. Please add revenue data first.")

        assignments = db.query(TeacherAssignment).filter(
            TeacherAssignment.stage_id == stage_id
        ).all()
        if excluded_ids:
            assignments = [a for a in assignments if a.library_id not in excluded_ids]
        if not assignments:
            raise HTTPException(status_code=400, detail="No teacher assignments found after exclusions.")

        # Delete old payments for this period+stage
        db.query(TeacherPayment).filter(
            TeacherPayment.period_id == period_id,
            TeacherPayment.stage_id  == stage_id,
        ).delete()

        # ── Build raw watch-time map + monthly breakdown ──────────────────────
        watch_time_map = {}  # library_id → total seconds for period months
        monthly_map    = {}  # library_id → {month_str: seconds}

        for a in assignments:
            lib_id = a.library_id
            if lib_id in watch_time_map:
                continue

            breakdown = {}
            total = 0

            if period_months:
                for month_str in period_months:
                    try:
                        yr, mo = map(int, month_str.split("-"))
                    except ValueError:
                        continue
                    stat = db.query(models.LibraryHistoricalStats).filter(
                        models.LibraryHistoricalStats.library_id == lib_id,
                        models.LibraryHistoricalStats.year  == yr,
                        models.LibraryHistoricalStats.month == mo,
                    ).first()
                    secs = stat.total_watch_time_seconds if stat else 0
                    breakdown[month_str] = secs
                    total += secs
            else:
                # Fallback: all stats for the period year
                stats = db.query(models.LibraryHistoricalStats).filter(
                    models.LibraryHistoricalStats.library_id == lib_id,
                    models.LibraryHistoricalStats.year       == period.year,
                ).all()
                for stat in stats:
                    key  = f"{stat.year}-{stat.month:02d}"
                    breakdown[key] = stat.total_watch_time_seconds
                    total += stat.total_watch_time_seconds

            watch_time_map[lib_id] = total
            monthly_map[lib_id]    = breakdown

        # ── Caches ───────────────────────────────────────────────────────────
        subject_cache = {}
        def get_subject(sid):
            if sid not in subject_cache:
                subject_cache[sid] = db.query(Subject).filter(Subject.id == sid).first()
            return subject_cache[sid]

        section_map = {s.id: s for s in db.query(Section).filter(Section.stage_id == stage_id).all()}

        # ── Orders totals ─────────────────────────────────────────────────────
        total_all_orders  = sum(rev.total_orders for rev in section_revenues) or 1
        orders_by_section = {rev.section_id: rev.total_orders for rev in section_revenues}

        # ── STEP 1: Allocate common watch time per section ────────────────────
        # Each common assignment belongs to ONE section (auto-match creates one per section).
        # allocated_wt = raw_wt * (section_orders / total_all_orders)
        allocated_wt = {rev.section_id: {} for rev in section_revenues}

        for a in assignments:
            subj = get_subject(a.subject_id)
            if not (subj and subj.is_common):
                continue
            if a.section_id not in allocated_wt:
                continue  # section not in this period's revenues — skip
            raw_wt = watch_time_map.get(a.library_id, 0)
            ratio  = orders_by_section.get(a.section_id, 0) / total_all_orders
            alloc  = raw_wt * ratio
            key = (a.library_id, a.subject_id)
            allocated_wt[a.section_id][key] = alloc
            logger.info(f"Common lib {a.library_id} → sec {a.section_id}: {alloc:.0f}s (ratio={ratio:.3f})")

        # ── STEP 2: Build section watch-time pools ────────────────────────────
        # pool = Σ allocated_wt (common) + Σ raw_wt (specific)
        section_pool = {}
        for rev in section_revenues:
            sec_id = rev.section_id
            common_total = sum(allocated_wt[sec_id].values())
            specific_total = sum(
                watch_time_map.get(a.library_id, 0)
                for a in assignments
                if a.section_id == sec_id
                and not (get_subject(a.subject_id) and get_subject(a.subject_id).is_common)
            )
            section_pool[sec_id] = common_total + specific_total
            logger.info(f"Section {sec_id} pool: common={common_total:.0f}s specific={specific_total:.0f}s total={section_pool[sec_id]:.0f}s")

        # ── STEP 3: Create payment records ────────────────────────────────────
        payments_created  = []
        total_payment_sum = 0.0

        for rev in section_revenues:
            sec_id      = rev.section_id
            sec_revenue = rev.total_revenue_egp
            sec_orders  = rev.total_orders
            pool        = section_pool.get(sec_id, 0)
            ord_frac    = orders_by_section[sec_id] / total_all_orders

            # Common assignments for THIS section only
            for a in assignments:
                if a.section_id != sec_id:
                    continue
                subj = get_subject(a.subject_id)
                if not (subj and subj.is_common):
                    continue

                key        = (a.library_id, a.subject_id)
                teacher_wt = allocated_wt[sec_id].get(key, 0)
                wt_pct     = (teacher_wt / pool) if pool > 0 else 0.0

                base_rev = sec_revenue * wt_pct
                calc_rev = base_rev * a.revenue_percentage
                tax_amt  = calc_rev * a.tax_rate
                final    = calc_rev - tax_amt

                payment = TeacherPayment(
                    period_id=period_id, assignment_id=a.id,
                    library_id=a.library_id, library_name=a.library_name,
                    stage_id=stage_id, section_id=sec_id, subject_id=a.subject_id,
                    total_watch_time_seconds=int(teacher_wt),
                    watch_time_percentage=wt_pct,
                    monthly_watch_breakdown=monthly_map.get(a.library_id, {}),
                    section_total_orders=sec_orders,
                    section_order_percentage=ord_frac,
                    base_revenue=base_rev,
                    revenue_percentage_applied=a.revenue_percentage,
                    calculated_revenue=calc_rev,
                    tax_rate_applied=a.tax_rate,
                    tax_amount=tax_amt,
                    final_payment=final,
                )
                db.add(payment)
                payments_created.append(payment)
                total_payment_sum += final

            # Specific assignments for THIS section only
            for a in assignments:
                if a.section_id != sec_id:
                    continue
                subj = get_subject(a.subject_id)
                if subj and subj.is_common:
                    continue  # already handled above

                teacher_wt = watch_time_map.get(a.library_id, 0)
                wt_pct     = (teacher_wt / pool) if pool > 0 else 0.0

                base_rev = sec_revenue * wt_pct
                calc_rev = base_rev * a.revenue_percentage
                tax_amt  = calc_rev * a.tax_rate
                final    = calc_rev - tax_amt

                payment = TeacherPayment(
                    period_id=period_id, assignment_id=a.id,
                    library_id=a.library_id, library_name=a.library_name,
                    stage_id=stage_id, section_id=sec_id, subject_id=a.subject_id,
                    total_watch_time_seconds=teacher_wt,
                    watch_time_percentage=wt_pct,
                    monthly_watch_breakdown=monthly_map.get(a.library_id, {}),
                    section_total_orders=sec_orders,
                    section_order_percentage=ord_frac,
                    base_revenue=base_rev,
                    revenue_percentage_applied=a.revenue_percentage,
                    calculated_revenue=calc_rev,
                    tax_rate_applied=a.tax_rate,
                    tax_amount=tax_amt,
                    final_payment=final,
                )
                db.add(payment)
                payments_created.append(payment)
                total_payment_sum += final

        db.commit()

        # Serialize for response
        payments_with_details = []
        for payment in payments_created:
            db.refresh(payment)
            sec  = section_map.get(payment.section_id)
            subj = get_subject(payment.subject_id)
            payments_with_details.append(TeacherPaymentWithDetails(
                **_payment_with_details_to_dict(
                    payment,
                    stage_name=stage.name,
                    section_name=sec.name if sec else None,
                    subject_name=subj.name if subj else None,
                    subject_is_common=subj.is_common if subj else None,
                )
            ))

        return CalculatePaymentsResponse(
            success=True,
            message=f"Successfully calculated payments for {len(payments_created)} teachers",
            payments_calculated=len(payments_created),
            total_payment=total_payment_sum,
            payments=payments_with_details,
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Payment calculation error: {e}")
        import traceback; logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail="An internal server error occurred. Please try again.")
        
# ============================================
# TEMPORARY - DELETE AFTER USE
# ============================================

@app.get("/setup/create-admin")
def create_admin(db: Session = Depends(get_db)):
    try:
        existing = db.query(models.User).filter(
            models.User.email == "operation@elkheta.com"
        ).first()
        
        if existing:
            existing.password_hash = hash_password("1111")
            existing.is_active = True
            db.commit()
            return {"message": "User updated successfully", "email": existing.email}
        
        db_user = models.User(
            email="operation@elkheta.com",
            password_hash=hash_password("1111"),
            is_active=True,
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        return {"message": "Admin user created", "id": db_user.id}
    
    except Exception as e:
        db.rollback()
        return {"error": str(e)}
        
@app.get("/teacher-payments/{period_id}", response_model=List[TeacherPaymentWithDetails])
def get_teacher_payments(period_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    payments = db.query(TeacherPayment).filter(TeacherPayment.period_id == period_id).all()
    payments_with_details = []
    for payment in payments:
        stage = db.query(Stage).filter(Stage.id == payment.stage_id).first()
        section = db.query(Section).filter(Section.id == payment.section_id).first()
        subject = db.query(Subject).filter(Subject.id == payment.subject_id).first()
        payment_dict = {**payment.__dict__, "stage_name": stage.name if stage else None,
                        "section_name": section.name if section else None,
                        "subject_name": subject.name if subject else None,
                        "subject_is_common": subject.is_common if subject else None}
        payments_with_details.append(TeacherPaymentWithDetails(**payment_dict))
    return payments_with_details
