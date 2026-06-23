import time
from api.user_api import IPRateLimiter

def test_ip_rate_limiter_allows_under_limit():
    limiter = IPRateLimiter(limit=3, window_seconds=2.0)
    # 3 requests allowed in 2 seconds
    assert limiter.is_allowed("127.0.0.1") is True
    assert limiter.is_allowed("127.0.0.1") is True
    assert limiter.is_allowed("127.0.0.1") is True
    # 4th should be blocked
    assert limiter.is_allowed("127.0.0.1") is False

    # Another IP should be independent
    assert limiter.is_allowed("192.168.1.1") is True

def test_ip_rate_limiter_expires():
    limiter = IPRateLimiter(limit=2, window_seconds=0.5)
    assert limiter.is_allowed("127.0.0.1") is True
    assert limiter.is_allowed("127.0.0.1") is True
    assert limiter.is_allowed("127.0.0.1") is False # Blocked

    # Wait for window to expire
    time.sleep(0.6)
    assert limiter.is_allowed("127.0.0.1") is True
