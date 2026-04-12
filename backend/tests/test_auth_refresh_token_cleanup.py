import unittest
from unittest.mock import MagicMock

from app.api.auth.auth import _detach_refresh_token_references, cleanup_refresh_tokens, utc_now
from app.models.operator_chat_session import OperatorChatSession
from app.models.user import RefreshToken


class RefreshTokenCleanupTestCase(unittest.TestCase):
    def test_detach_refresh_token_references_nulls_chat_session_fk(self) -> None:
        db = MagicMock()
        query = db.query.return_value
        filtered = query.filter.return_value

        _detach_refresh_token_references(db, [4, 7])

        db.query.assert_called_once()
        query.filter.assert_called_once()
        filtered.update.assert_called_once()
        args, kwargs = filtered.update.call_args
        self.assertEqual(args[0], {OperatorChatSession.refresh_token_id: None})
        self.assertEqual(kwargs["synchronize_session"], False)
        db.flush.assert_called_once()

    def test_cleanup_detaches_before_deleting_tokens(self) -> None:
        db = MagicMock()
        expired_token = RefreshToken(id=6, token="expired", user_id=1, is_revoked=False, expires_at=utc_now())
        refresh_query = MagicMock()
        user_filter = MagicMock()
        expired_filter = MagicMock()
        refresh_query.filter.return_value = user_filter
        user_filter.filter.return_value = expired_filter
        expired_filter.all.return_value = [expired_token]

        session_query = MagicMock()
        session_filter = MagicMock()
        session_query.filter.return_value = session_filter

        db.query.side_effect = [refresh_query, session_query]

        cleanup_refresh_tokens(db, user_id=1)

        session_filter.update.assert_called_once()
        db.delete.assert_called_once_with(expired_token)
        db.flush.assert_called_once()
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
