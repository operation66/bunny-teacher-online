import httpx
import os
from dotenv import load_dotenv
import logging
from typing import List, Dict, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session
import pytz

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
BUNNY_STREAM_API_KEY = os.getenv("BUNNY_STREAM_API_KEY")
BUNNY_API_BASE_URL = "https://api.bunny.net"
BUNNY_STREAM_API_BASE_URL = "https://video.bunnycdn.com"

# Bunny.net uses UTC timezone for their dashboard
BUNNY_TIMEZONE = pytz.UTC

def get_library_api_key(library_id: int, db: Session) -> Optional[str]:
    """
    Get the API key for a specific library from the database
    Falls back to the global BUNNY_STREAM_API_KEY if not found
    """
    if not db:
        return BUNNY_STREAM_API_KEY
    
    try:
        from models import LibraryConfig
        library = db.query(LibraryConfig).filter(LibraryConfig.library_id == library_id).first()
        if library and library.stream_api_key:
            logger.info(f"Using library-specific API key for library {library_id}")
            return library.stream_api_key
        else:
            logger.info(f"No library-specific API key found for library {library_id}, using global key")
            return BUNNY_STREAM_API_KEY
    except Exception as e:
        logger.error(f"Error retrieving API key for library {library_id}: {str(e)}")
        return BUNNY_STREAM_API_KEY

def format_date_for_bunny_api(date_obj: datetime) -> str:
    """
    Format date for Bunny.net API in the exact format they expect: m-d-Y
    Ensures timezone consistency with Bunny.net dashboard
    """
    # Convert to UTC if not already
    if date_obj.tzinfo is None:
        date_obj = BUNNY_TIMEZONE.localize(date_obj)
    elif date_obj.tzinfo != BUNNY_TIMEZONE:
        date_obj = date_obj.astimezone(BUNNY_TIMEZONE)
    
    # Format as m-d-Y with zero-padded month/day (e.g., "09-01-2025")
    # Use manual formatting to avoid Windows compatibility issues
    month = str(date_obj.month).zfill(2)
    day = str(date_obj.day).zfill(2)
    year = str(date_obj.year)
    return date_obj.strftime("%Y-%m-%d")

def get_precise_date_range(month: int, year: int):
    """
    Get precise date range for a month with exact start and end times
    Returns dates formatted for Bunny.net API in UTC timezone
    """
    import calendar
    
    # First day of the month at 00:00:00 UTC
    start_date_obj = datetime(year, month, 1, 0, 0, 0, tzinfo=BUNNY_TIMEZONE)
    
    # Last day of the month at 23:59:59 UTC
    last_day = calendar.monthrange(year, month)[1]
    end_date_obj = datetime(year, month, last_day, 23, 59, 59, tzinfo=BUNNY_TIMEZONE)
    
    # Format for Bunny.net API
    start_date = format_date_for_bunny_api(start_date_obj)
    end_date = format_date_for_bunny_api(end_date_obj)
    
    logger.info(f"Precise date range: {start_date} to {end_date} (UTC)")
    return start_date, end_date

async def get_bunny_libraries() -> List[Dict]:
    """
    Fetch all video libraries from Bunny.net Stream API
    Returns a list of libraries with their basic information
    """
    if not BUNNY_STREAM_API_KEY:
        logger.error("BUNNY_STREAM_API_KEY not found in environment variables")
        return []
    
    try:
        headers = {
            "AccessKey": BUNNY_STREAM_API_KEY,
            "Content-Type": "application/json",
            "User-Agent": "Python/httpx"
        }
        
        # Configure client with proper settings for Windows environment
        async with httpx.AsyncClient(
            verify=True,  # Enable SSL verification
            timeout=httpx.Timeout(60.0, connect=30.0),  # Separate connect timeout
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        ) as client:
            logger.info("Attempting to connect to Bunny.net API...")
            
            # Try to fetch with a high perPage to minimize pagination
            page = 1
            per_page = 200
            all_items: List[Dict] = []
            total_items = None
            
            while True:
                try:
                    response = await client.get(
                        f"{BUNNY_API_BASE_URL}/videolibrary",
                        headers=headers,
                        params={"page": page, "perPage": per_page}
                    )
                except Exception as e:
                    logger.error(f"Error requesting Bunny libraries page {page}: {e}")
                    break

                if response.status_code != 200:
                    logger.error(f"Failed to fetch libraries (page {page}): {response.status_code} - {response.text}")
                    break

                data = response.json()
                # Bunny API may return either a list, or an object with items
                if isinstance(data, list):
                    items = data
                    # Accumulate list responses across pages
                    if page == 1:
                        all_items = items
                    else:
                        all_items.extend(items)
                    # If fewer than per_page, we've reached the end; otherwise continue
                    if len(items) < per_page:
                        break
                    page += 1
                    continue
                elif isinstance(data, dict):
                    items = data.get("items") or data.get("Items") or data.get("data") or []
                    if total_items is None:
                        total_items = data.get("totalItems") or data.get("TotalItems") or data.get("total") or None
                    if not items:
                        break
                    all_items.extend(items)
                    # Stop if we've retrieved all known items
                    if total_items is not None and len(all_items) >= int(total_items):
                        break
                    page += 1
                else:
                    logger.error("Unexpected Bunny libraries response format")
                    break
            
            logger.info(f"Successfully collected {len(all_items)} libraries from Bunny.net across pages")
            
            libraries_simplified = []
            for library in all_items:
                # Support both capitalized and lowercase keys
                library_id = library.get("Id") if "Id" in library else library.get("id")
                library_name = library.get("Name") if "Name" in library else library.get("name")
                if library_name is None:
                    library_name = f"Library {library_id}"
                
                libraries_simplified.append({
                    "id": library_id,
                    "name": library_name,
                    "original_data": library
                })
            
            return libraries_simplified
                
    except httpx.ConnectError as e:
        logger.error(f"Failed to connect to Bunny.net API: {str(e)}")
        return []
    except httpx.TimeoutException as e:
        logger.error(f"Request timeout to Bunny.net API: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Unexpected error fetching libraries: {str(e)}")
        return []

async def get_library_monthly_stats(library_id: int, month: int, year: int, db: Session = None) -> Dict:
    """
    Get monthly statistics for a specific library using library-specific API key
    Returns only accurate view counts and watch time from the Stream API
    Uses precise timezone-aware date ranges for 100% accuracy
    """
    # Get the appropriate API key for this library
    api_key = get_library_api_key(library_id, db) if db else BUNNY_STREAM_API_KEY
    
    if not api_key:
        logger.error(f"No API key available for library {library_id}")
        return {
            "library_name": f"Library {library_id}",
            "total_views": 0, 
            "total_watch_time_seconds": 0, 
            "bandwidth_gb": 0.0,
            "views_chart": {},
            "watch_time_chart": {},
            "bandwidth_chart": {},
            "last_updated": None
        }
    
    # Get precise date range with timezone awareness
    start_date, end_date = get_precise_date_range(month, year)
    
    try:
        headers = {
            "AccessKey": api_key,
            "Content-Type": "application/json",
            "User-Agent": "BunnyTeacher/1.0"
        }
        
        params = {
            "dateFrom": start_date,
            "dateTo": end_date,
            "hourly": "false"
        }
        
        async with httpx.AsyncClient(verify=True, timeout=60.0) as client:
            logger.info(f"Making request to: {BUNNY_STREAM_API_BASE_URL}/library/{library_id}/statistics")
            logger.info(f"Using API key: {api_key[:10]}...")
            logger.info(f"Precise date range: {start_date} to {end_date} (UTC)")
            
            # First get library info to get the name
            library_name = f"Library {library_id}"
            try:
                library_response = await client.get(
                    f"{BUNNY_STREAM_API_BASE_URL}/library/{library_id}",
                    headers=headers
                )
                if library_response.status_code == 200:
                    library_data = library_response.json()
                    library_name = library_data.get("name", f"Library {library_id}")
            except Exception as e:
                logger.warning(f"Could not fetch library name for {library_id}: {str(e)}")
            
            response = await client.get(
                f"{BUNNY_STREAM_API_BASE_URL}/library/{library_id}/statistics",
                headers=headers,
                params=params
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"API Response for library {library_id}: {data}")
                
                # Extract statistics from the actual API response structure
                views_chart = data.get("viewsChart", {})
                watch_time_chart = data.get("watchTimeChart", {})
                bandwidth_chart = data.get("bandwidthChart", {})
                
                # Use viewsChart for accurate day-by-day view count (matches dashboard exactly)
                total_views = sum(views_chart.values()) if views_chart else 0
                
                # Calculate total watch time in seconds from watchTimeChart
                total_watch_time_seconds = sum(watch_time_chart.values()) if watch_time_chart else 0
                
                # Calculate total bandwidth in GB from bandwidthChart
                total_bandwidth_bytes = sum(bandwidth_chart.values()) if bandwidth_chart else 0
                bandwidth_gb = total_bandwidth_bytes / (1024 ** 3) if total_bandwidth_bytes > 0 else 0.0
                
                # Add timestamp for data freshness tracking
                last_updated = datetime.now(BUNNY_TIMEZONE).isoformat()
                
                logger.info(f"Library {library_id} stats for {month}/{year}: {total_views} views, {total_watch_time_seconds} seconds watch time, {bandwidth_gb:.2f} GB bandwidth")
                
                return {
                    "library_name": library_name,
                    "total_views": total_views,
                    "total_watch_time_seconds": total_watch_time_seconds,
                    "bandwidth_gb": bandwidth_gb,
                    "views_chart": views_chart,
                    "watch_time_chart": watch_time_chart,
                    "bandwidth_chart": bandwidth_chart,
                    "last_updated": last_updated,
                    "raw_data": data  # Include raw data for debugging
                }
            else:
                logger.error(f"Failed to fetch stats for library {library_id}: {response.status_code} - {response.text}")
                return {
                    "library_name": library_name,
                    "total_views": 0, 
                    "total_watch_time_seconds": 0, 
                    "bandwidth_gb": 0.0,
                    "views_chart": {},
                    "watch_time_chart": {},
                    "bandwidth_chart": {},
                    "last_updated": None, 
                    "error": response.text
                }
                
    except httpx.ConnectError as e:
        logger.error(f"Failed to connect to Bunny.net API for library {library_id}: {str(e)}")
        return {
            "library_name": f"Library {library_id}",
            "total_views": 0, 
            "total_watch_time_seconds": 0, 
            "bandwidth_gb": 0.0,
            "views_chart": {},
            "watch_time_chart": {},
            "bandwidth_chart": {},
            "last_updated": None, 
            "error": str(e)
        }
    except httpx.TimeoutException as e:
        logger.error(f"Request timeout to Bunny.net API for library {library_id}: {str(e)}")
        return {
            "library_name": f"Library {library_id}",
            "total_views": 0, 
            "total_watch_time_seconds": 0, 
            "bandwidth_gb": 0.0,
            "views_chart": {},
            "watch_time_chart": {},
            "bandwidth_chart": {},
            "last_updated": None, 
            "error": str(e)
        }
    except Exception as e:
        logger.error(f"Unexpected error fetching stats for library {library_id}: {str(e)}")
        return {
            "library_name": f"Library {library_id}",
            "total_views": 0, 
            "total_watch_time_seconds": 0, 
            "bandwidth_gb": 0.0,
            "views_chart": {},
            "watch_time_chart": {},
            "bandwidth_chart": {},
            "last_updated": None, 
            "error": str(e)
        }

async def get_bunny_stats(library_id: int, start_date: str, end_date: str) -> Dict:
    """
    Get statistics for a specific library and date range
    Returns only accurate view counts and watch time from the Stream API
    Uses precise timezone-aware formatting
    """
    if not BUNNY_STREAM_API_KEY:
        logger.error("BUNNY_STREAM_API_KEY not found in environment variables")
        return {"total_views": 0, "total_watch_time_seconds": 0, "last_updated": None}
    
    try:
        headers = {
            "AccessKey": BUNNY_STREAM_API_KEY,
            "Content-Type": "application/json",
            "User-Agent": "BunnyTeacher/1.0"
        }
        
        # Convert dates to proper format if they're in YYYY-MM-DD format
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            
            # Convert to Bunny.net format
            start_date = format_date_for_bunny_api(start_dt)
            end_date = format_date_for_bunny_api(end_dt)
        except ValueError:
            # Assume dates are already in correct format
            pass
        
        params = {
            "dateFrom": start_date,
            "dateTo": end_date,
            "hourly": "false"
        }
        
        async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
            response = await client.get(
                f"{BUNNY_STREAM_API_BASE_URL}/library/{library_id}/statistics",
                headers=headers,
                params=params
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Extract statistics from the actual API response structure
                views_chart = data.get("viewsChart", {})
                watch_time_chart = data.get("watchTimeChart", {})
                
                # Use viewsChart for accurate day-by-day view count (matches dashboard exactly)
                total_views = sum(views_chart.values()) if views_chart else 0
                
                # Calculate total watch time in seconds from watchTimeChart
                total_watch_time_seconds = sum(watch_time_chart.values()) if watch_time_chart else 0
                
                # Add timestamp for data freshness tracking
                last_updated = datetime.now(BUNNY_TIMEZONE).isoformat()
                
                return {
                    "total_views": total_views,
                    "total_watch_time_seconds": total_watch_time_seconds,
                    "last_updated": last_updated
                }
            else:
                logger.error(f"Failed to fetch stats for library {library_id}: {response.status_code} - {response.text}")
                return {"total_views": 0, "total_watch_time_seconds": 0, "last_updated": None}
                
    except Exception as e:
        logger.error(f"Error fetching stats for library {library_id}: {str(e)}")
        return {"total_views": 0, "total_watch_time_seconds": 0, "last_updated": None}
