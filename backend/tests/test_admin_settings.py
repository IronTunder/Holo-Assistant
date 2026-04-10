import unittest
import shutil
from pathlib import Path

from fastapi import HTTPException

from app.api.auth import auth as auth_module
from app.api.auth.auth import user_has_permission, verify_permission
from app.models.role import ALL_PERMISSIONS, Role
from app.models.user import User
from app.services.admin_settings import SettingsValidationError, get_settings_payload, update_env_file

TEST_TEMP_DIR = Path(__file__).resolve().parent / "_tmp_admin_settings"


class AdminSettingsTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        if TEST_TEMP_DIR.exists():
            shutil.rmtree(TEST_TEMP_DIR, ignore_errors=True)
        TEST_TEMP_DIR.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        shutil.rmtree(TEST_TEMP_DIR, ignore_errors=True)

    def test_admin_role_permissions_include_settings_permissions(self) -> None:
        self.assertIn("settings.view", ALL_PERMISSIONS)
        self.assertIn("settings.edit", ALL_PERMISSIONS)

        role = Role(name="Admin", code="admin", is_system=True, is_active=True)
        role.permissions = ALL_PERMISSIONS
        user = User(nome="Admin", badge_id="ADMIN", role=role)

        self.assertTrue(user_has_permission(user, "settings.view"))
        self.assertTrue(user_has_permission(user, "settings.edit"))

    def test_secret_key_placeholder_is_rejected_without_test_override(self) -> None:
        previous_secret = auth_module.os.environ.get("SECRET_KEY")
        previous_override = auth_module.os.environ.get("HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS")
        try:
            auth_module.os.environ["SECRET_KEY"] = "your-super-secret-key-change-this-in-production"
            auth_module.os.environ["HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS"] = "false"
            with self.assertRaises(RuntimeError):
                auth_module._require_secret_key()
        finally:
            if previous_secret is None:
                auth_module.os.environ.pop("SECRET_KEY", None)
            else:
                auth_module.os.environ["SECRET_KEY"] = previous_secret
            if previous_override is None:
                auth_module.os.environ.pop("HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS", None)
            else:
                auth_module.os.environ["HOLO_ASSISTANT_ALLOW_INSECURE_DEFAULTS"] = previous_override

    async def test_settings_view_does_not_allow_edit(self) -> None:
        role = Role(name="Settings Viewer", code="settings-viewer", is_active=True)
        role.permissions = ["backoffice.access", "settings.view"]
        user = User(nome="Viewer", badge_id="VIEWER", role=role)

        self.assertTrue(user_has_permission(user, "settings.view"))
        self.assertFalse(user_has_permission(user, "settings.edit"))

        edit_dependency = verify_permission("settings.edit")
        with self.assertRaises(HTTPException) as context:
            await edit_dependency(user)

        self.assertEqual(context.exception.status_code, 403)

    def test_payload_exposes_only_allowlisted_settings(self) -> None:
        env_path = TEST_TEMP_DIR / "settings.env"
        env_path.write_text(
            "\n".join(
                [
                    "SECRET_KEY=do-not-show",
                    "ADMIN_PASSWORD=do-not-show",
                    "DATABASE_PASSWORD=do-not-show",
                    "VITE_API_URL=https://localhost:8000",
                    "OLLAMA_MODEL=qwen3.5:9b",
                ]
            ),
            encoding="utf-8",
        )

        payload = get_settings_payload(env_path)
        keys = {
            setting["key"]
            for group in payload["groups"]
            for setting in group["settings"]
        }
        values = {
            setting["value"]
            for group in payload["groups"]
            for setting in group["settings"]
        }

        self.assertIn("OLLAMA_MODEL", keys)
        self.assertNotIn("SECRET_KEY", keys)
        self.assertNotIn("ADMIN_PASSWORD", keys)
        self.assertNotIn("VITE_API_URL", keys)
        self.assertNotIn("do-not-show", values)
        self.assertIn("DATABASE_HOST", keys)
        self.assertIn("DATABASE_PASSWORD", keys)

        database_password = next(
            setting
            for group in payload["groups"]
            for setting in group["settings"]
            if setting["key"] == "DATABASE_PASSWORD"
        )
        self.assertEqual(database_password["value"], "")
        self.assertTrue(database_password["has_value"])
        self.assertTrue(database_password["sensitive"])

    def test_update_env_file_preserves_unmanaged_keys_and_rejects_invalid_values(self) -> None:
        env_path = TEST_TEMP_DIR / "settings.env"
        env_path.write_text(
            "# Existing\nSECRET_KEY=keep-me\nOLLAMA_MODEL=old-model\nCUSTOM_FLAG=1\n",
            encoding="utf-8",
        )

        with self.assertRaises(SettingsValidationError) as context:
            update_env_file(
                {
                    "SECRET_KEY": "leak",
                    "OLLAMA_TOP_P": "2",
                },
                env_path,
            )

        self.assertIn("SECRET_KEY", context.exception.errors)
        self.assertIn("OLLAMA_TOP_P", context.exception.errors)

        payload = update_env_file(
            {
                "OLLAMA_MODEL": "qwen3.5:9b",
                "TTS_ENABLED": "yes",
                "DATABASE_HOST": "10.0.0.10",
                "DATABASE_PASSWORD": "new-db-password",
                "ALLOWED_ORIGINS": "https://localhost:5173,https://127.0.0.1:5173",
            },
            env_path,
        )

        contents = env_path.read_text(encoding="utf-8")
        self.assertIn("SECRET_KEY=keep-me", contents)
        self.assertIn("CUSTOM_FLAG=1", contents)
        self.assertIn("OLLAMA_MODEL=qwen3.5:9b", contents)
        self.assertIn("TTS_ENABLED=true", contents)
        self.assertIn("DATABASE_HOST=10.0.0.10", contents)
        self.assertIn("DATABASE_PASSWORD=new-db-password", contents)
        self.assertIn("ALLOWED_ORIGINS=https://localhost:5173,https://127.0.0.1:5173", contents)
        self.assertTrue(payload["pending_restart"])

        database_password = next(
            setting
            for group in payload["groups"]
            for setting in group["settings"]
            if setting["key"] == "DATABASE_PASSWORD"
        )
        self.assertEqual(database_password["value"], "")
        self.assertTrue(database_password["has_value"])


if __name__ == "__main__":
    unittest.main()
