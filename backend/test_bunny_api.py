import asyncio
import httpx
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def test_bunny_api():
    api_key = os.getenv('BUNNY_STREAM_API_KEY')
    print(f'API Key: {api_key[:10]}...' if api_key else 'No API key found')
    
    if not api_key:
        print("ERROR: BUNNY_STREAM_API_KEY not found in environment variables")
        return
    
    try:
        async with httpx.AsyncClient(verify=False) as client:
            response = await client.get(
                'https://api.bunny.net/videolibrary',
                headers={'AccessKey': api_key},
                timeout=30.0
            )
            print(f'Status Code: {response.status_code}')
            print(f'Response: {response.text[:500]}')
            
            if response.status_code == 200:
                libraries = response.json()
                print(f'Found {len(libraries)} libraries')
                for lib in libraries[:3]:  # Show first 3 libraries
                    print(f"- Library ID: {lib.get('Id')}, Name: {lib.get('Name')}")
            else:
                print(f'Error: {response.status_code} - {response.text}')
                
    except Exception as e:
        print(f'Exception: {str(e)}')
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_bunny_api())