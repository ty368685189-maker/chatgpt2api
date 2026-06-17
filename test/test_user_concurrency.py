import threading
import time
import unittest
from services.protocol.conversation import UserConcurrencyLimiter
from unittest import mock


class UserConcurrencyLimiterTests(unittest.TestCase):
    @mock.patch("services.protocol.conversation.config")
    def test_concurrency_limiting(self, mock_config) -> None:
        mock_config.image_user_concurrency = 2
        limiter = UserConcurrencyLimiter()
        
        # Acquire 2 slots for user1 - should not block
        limiter.acquire("user1")
        limiter.acquire("user1")
        
        # Trying to acquire a 3rd slot should block
        blocked = []
        def acquire_third() -> None:
            limiter.acquire("user1")
            blocked.append(False)
            
        t = threading.Thread(target=acquire_third)
        t.start()
        
        time.sleep(0.1)
        self.assertEqual(len(blocked), 0)  # Verify it is blocked
        
        # Release 1 slot for user1 - should unblock the 3rd acquire
        limiter.release("user1")
        
        t.join(timeout=1)
        self.assertEqual(len(blocked), 1)  # Verify it unblocked
        
        # Clean up
        limiter.release("user1")
        limiter.release("user1")


if __name__ == "__main__":
    unittest.main()
