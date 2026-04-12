import unittest
from datetime import timedelta

from fastapi import HTTPException, Response
from sqlalchemy import create_engine
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.admin import (
    DepartmentRequest,
    MachineUpdateRequest,
    RoleRequest,
    UserUpdateRequest,
    create_department,
    create_role,
    delete_department,
    delete_machine,
    delete_user,
    list_departments_metadata,
    update_machine,
    update_role,
    update_user,
)
from app.api.auth.auth import (
    BadgeLoginRequest,
    CredentialsLoginRequest,
    LogoutRequest,
    SSETokenRequest,
    badge_login,
    create_operator_sse_token,
    create_refresh_token,
    credentials_login,
    get_password_hash,
    logout,
    user_has_permission,
)
from app.database import Base
from app.models.department import Department
from app.models.machine import Machine
from app.models.working_station import WorkingStation
from app.models.role import (
    ADMIN_DEFAULT_PERMISSIONS,
    ADMIN_ROLE_CODE,
    ALL_PERMISSIONS,
    MAINTENANCE_TECH_DEFAULT_PERMISSIONS,
    MAINTENANCE_TECH_ROLE_CODE,
    OPERATOR_DEFAULT_PERMISSIONS,
    Role,
)
from app.models.user import LivelloEsperienza, RefreshToken, Ruolo, Turno, User
from app.services.cache import admin_metadata_cache


class RbacAdminTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.db = self.SessionLocal()
        self._seed_fixture()
        admin_metadata_cache.clear()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        admin_metadata_cache.clear()

    def _seed_fixture(self) -> None:
        self.admin_role = Role(
            name="Admin",
            code=ADMIN_ROLE_CODE,
            description="Sistema",
            is_system=True,
            is_active=True,
        )
        self.admin_role.permissions = ADMIN_DEFAULT_PERMISSIONS
        self.tech_role = Role(
            name="Tecnico Manutenzione",
            code=MAINTENANCE_TECH_ROLE_CODE,
            description="Tecnici",
            is_system=True,
            is_active=True,
        )
        self.tech_role.permissions = [
            *MAINTENANCE_TECH_DEFAULT_PERMISSIONS,
        ]
        self.operator_role = Role(
            name="Operaio",
            code="operaio",
            description="Operatore",
            is_system=True,
            is_active=True,
        )
        self.operator_role.permissions = OPERATOR_DEFAULT_PERMISSIONS
        department = Department(name="Manutenzione", code="manutenzione", is_active=True)
        self.db.add_all([self.admin_role, self.tech_role, self.operator_role, department])
        self.db.flush()
        self.admin = User(
            nome="Admin",
            badge_id="ADMIN",
            password_hash=get_password_hash("admin-password"),
            ruolo=Ruolo.ADMIN,
            role_id=self.admin_role.id,
            livello_esperienza=LivelloEsperienza.SENIOR,
            department_id=department.id,
            reparto_legacy=department.name,
            turno=Turno.MATTINA,
        )
        self.technician = User(
            nome="Tecnico",
            badge_id="TECH",
            password_hash=get_password_hash("tech-password"),
            ruolo=Ruolo.OPERAIO,
            role_id=self.tech_role.id,
            livello_esperienza=LivelloEsperienza.MANUTENTORE,
            department_id=department.id,
            reparto_legacy=department.name,
            turno=Turno.MATTINA,
        )
        self.operator = User(
            nome="Operaio",
            badge_id="OP",
            password_hash=get_password_hash("operator-password"),
            ruolo=Ruolo.OPERAIO,
            role_id=self.operator_role.id,
            livello_esperienza=LivelloEsperienza.OPERAIO,
            department_id=department.id,
            reparto_legacy=department.name,
            turno=Turno.MATTINA,
        )
        self.db.add_all([self.admin, self.technician, self.operator])
        self.db.commit()
        self.department_id = department.id

    async def test_permission_helper_uses_assigned_role(self) -> None:
        self.assertTrue(user_has_permission(self.admin, "roles.manage"))
        self.assertTrue(user_has_permission(self.technician, "interactions.resolve"))
        self.assertFalse(user_has_permission(self.technician, "users.manage"))
        self.assertFalse(user_has_permission(self.operator, "backoffice.access"))
        self.assertTrue(user_has_permission(self.operator, "operator.interface.access"))
        self.assertFalse(user_has_permission(self.admin, "operator.interface.access"))
        self.assertFalse(user_has_permission(self.technician, "operator.interface.access"))

    async def test_create_role_and_protect_admin_permissions(self) -> None:
        created_role = await create_role(
            RoleRequest(
                name="Responsabile Qualita",
                code="responsabile-qualita",
                description="Controllo qualita",
                permissions=["backoffice.access", "logs.view"],
                is_active=True,
            ),
            admin=self.admin,
            db=self.db,
        )

        self.assertEqual(created_role["code"], "responsabile-qualita")
        self.assertEqual(created_role["permissions"], ["backoffice.access", "logs.view"])

        with self.assertRaises(HTTPException) as context:
            await update_role(
                self.admin_role.id,
                RoleRequest(
                    name="Admin",
                    code=ADMIN_ROLE_CODE,
                    description="Sistema",
                    permissions=["backoffice.access"],
                    is_active=True,
                ),
                admin=self.admin,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 400)
        self.assertEqual(set(self.admin_role.permissions), set(ADMIN_DEFAULT_PERMISSIONS))

    async def test_delete_department_with_linked_machine_disables_it(self) -> None:
        machine = Machine(
            nome="Pressa",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-1",
            startup_checklist=[],
            in_uso=False,
        )
        self.db.add(machine)
        self.db.commit()

        await delete_department(self.department_id, admin=self.admin, db=self.db)

        department = self.db.query(Department).filter(Department.id == self.department_id).first()
        self.assertIsNotNone(department)
        self.assertFalse(department.is_active)

    async def test_create_department(self) -> None:
        created_department = await create_department(
            DepartmentRequest(
                name="Assemblaggio",
                code="assemblaggio",
                description="Linea assemblaggio",
                is_active=True,
            ),
            admin=self.admin,
            db=self.db,
        )

        self.assertEqual(created_department["name"], "Assemblaggio")
        self.assertTrue(created_department["is_active"])

    async def test_department_metadata_cache_hits_and_mutation_invalidates(self) -> None:
        first_payload = await list_departments_metadata(admin=self.admin, db=self.db)
        second_payload = await list_departments_metadata(admin=self.admin, db=self.db)

        self.assertEqual(first_payload, second_payload)
        self.assertGreaterEqual(admin_metadata_cache.stats().hits, 1)

        await create_department(
            DepartmentRequest(
                name="Assemblaggio",
                code="assemblaggio",
                description="Linea assemblaggio",
                is_active=True,
            ),
            admin=self.admin,
            db=self.db,
        )

        self.assertEqual(admin_metadata_cache.stats().entries, 0)

    async def test_logout_does_not_revoke_other_users_refresh_tokens(self) -> None:
        machine = Machine(
            nome="Pressa",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-1",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)
        admin_refresh_token = create_refresh_token(self.admin.id, self.db, expires_delta=timedelta(minutes=30))

        await logout(
            LogoutRequest(user_id=self.admin.id, machine_id=machine.id, refresh_token=admin_refresh_token),
            Response(),
            current_user=self.operator,
            db=self.db,
            refresh_token_cookie=None,
        )

        self.db.refresh(machine)
        self.assertFalse(machine.in_uso)
        self.assertIsNone(machine.operatore_attuale_id)
        self.assertIsNotNone(
            self.db.execute(
                select(RefreshToken).where(
                    RefreshToken.token == admin_refresh_token
                )
            ).scalar_one_or_none()
        )

    async def test_logout_releases_current_user_machine_without_machine_id(self) -> None:
        machine = Machine(
            nome="Tornio",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-2",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)

        await logout(
            LogoutRequest(user_id=self.operator.id, machine_id=None),
            Response(),
            current_user=self.operator,
            db=self.db,
            refresh_token_cookie=None,
        )

        self.db.refresh(machine)
        self.assertFalse(machine.in_uso)
        self.assertIsNone(machine.operatore_attuale_id)

    async def test_badge_login_releases_stale_machine_for_same_user(self) -> None:
        stale_machine = Machine(
            nome="Fresa",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-3",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        target_machine = Machine(
            nome="Trapano",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-4",
            startup_checklist=[],
            in_uso=False,
            operatore_attuale_id=None,
        )
        self.db.add_all([stale_machine, target_machine])
        self.db.commit()
        self.db.refresh(stale_machine)
        self.db.refresh(target_machine)

        await badge_login(
            BadgeLoginRequest(badge_id=self.operator.badge_id, machine_id=target_machine.id),
            Response(),
            db=self.db,
        )

        self.db.refresh(stale_machine)
        self.db.refresh(target_machine)
        self.assertFalse(stale_machine.in_uso)
        self.assertIsNone(stale_machine.operatore_attuale_id)
        self.assertTrue(target_machine.in_uso)
        self.assertEqual(target_machine.operatore_attuale_id, self.operator.id)

    async def test_badge_login_accepts_working_station_id(self) -> None:
        target_machine = Machine(
            nome="Trapano Canonico",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-WS-1",
            startup_checklist=["Controllo visivo iniziale"],
            in_uso=False,
            operatore_attuale_id=None,
        )
        self.db.add(target_machine)
        self.db.flush()
        working_station = WorkingStation(
            name="Postazione Canonica",
            department_id=self.department_id,
            description="Postazione assegnata al trapano",
            station_code="WS-CAN-1",
            startup_checklist=["Controllo visivo iniziale"],
            in_uso=False,
            operatore_attuale_id=None,
        )
        self.db.add(working_station)
        self.db.flush()
        target_machine.working_station_id = working_station.id
        self.db.commit()

        response = await badge_login(
            BadgeLoginRequest(badge_id=self.operator.badge_id, working_station_id=working_station.id),
            Response(),
            db=self.db,
        )

        self.db.refresh(working_station)
        self.db.refresh(target_machine)
        self.assertTrue(working_station.in_uso)
        self.assertEqual(working_station.operatore_attuale_id, self.operator.id)
        self.assertTrue(target_machine.in_uso)
        self.assertEqual(response.working_station.id, working_station.id)
    async def test_operator_system_role_defaults_to_operator_interface_permission(self) -> None:
        self.assertEqual(self.operator_role.permissions, OPERATOR_DEFAULT_PERMISSIONS)
        self.assertEqual(self.tech_role.permissions, MAINTENANCE_TECH_DEFAULT_PERMISSIONS)
        self.assertEqual(self.admin_role.permissions, ADMIN_DEFAULT_PERMISSIONS)
        self.assertIn("operator.interface.access", ALL_PERMISSIONS)

    async def test_badge_login_requires_operator_interface_permission(self) -> None:
        self.operator_role.permissions = []
        self.db.commit()

        machine = Machine(
            nome="Pressa",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-5",
            startup_checklist=[],
            in_uso=False,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await badge_login(
                BadgeLoginRequest(badge_id=self.operator.badge_id, machine_id=machine.id),
                Response(),
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail, "Accesso interfaccia operatore non consentito")

    async def test_credentials_login_requires_operator_interface_permission(self) -> None:
        self.operator_role.permissions = []
        self.db.commit()

        machine = Machine(
            nome="Tornio",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-6",
            startup_checklist=[],
            in_uso=False,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await credentials_login(
                CredentialsLoginRequest(
                    username=self.operator.nome,
                    password="operator-password",
                    machine_id=machine.id,
                ),
                Response(),
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail, "Accesso interfaccia operatore non consentito")

    async def test_sse_token_requires_operator_interface_permission(self) -> None:
        machine = Machine(
            nome="Fresa",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-7",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)

        with self.assertRaises(HTTPException) as context:
            await create_operator_sse_token(
                SSETokenRequest(machine_id=machine.id),
                current_user=self.admin,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail, "Accesso interfaccia operatore non consentito")

    async def test_sse_token_allows_admin_when_operator_permission_is_explicitly_granted(self) -> None:
        self.admin_role.permissions = [*ADMIN_DEFAULT_PERMISSIONS, "operator.interface.access"]
        self.db.commit()

        machine = Machine(
            nome="Trapano",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-8",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.admin.id,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)

        response = await create_operator_sse_token(
            SSETokenRequest(machine_id=machine.id),
            current_user=self.admin,
            db=self.db,
        )

        self.assertTrue(response.token)
        self.assertGreater(response.expires_in, 0)

    async def test_sse_token_allows_technician_when_operator_permission_is_explicitly_granted(self) -> None:
        self.tech_role.permissions = [*MAINTENANCE_TECH_DEFAULT_PERMISSIONS, "operator.interface.access"]
        self.db.commit()

        machine = Machine(
            nome="Segatrice",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-9",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.technician.id,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)

        response = await create_operator_sse_token(
            SSETokenRequest(machine_id=machine.id),
            current_user=self.technician,
            db=self.db,
        )

        self.assertTrue(response.token)
        self.assertGreater(response.expires_in, 0)

    async def test_sse_token_returns_conflict_when_machine_session_is_invalid(self) -> None:
        machine = Machine(
            nome="Laser",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-10",
            startup_checklist=[],
            in_uso=False,
            operatore_attuale_id=None,
        )
        self.db.add(machine)
        self.db.commit()
        self.db.refresh(machine)

        with self.assertRaises(HTTPException) as context:
            await create_operator_sse_token(
                SSETokenRequest(machine_id=machine.id),
                current_user=self.operator,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 409)

    async def test_update_machine_rejects_machine_in_use(self) -> None:
        machine = Machine(
            nome="Piegatrice",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-11",
            startup_checklist=["Controllo olio"],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await update_machine(
                machine.id,
                MachineUpdateRequest(nome="Piegatrice X"),
                admin=self.admin,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 409)

    async def test_delete_machine_rejects_machine_in_use(self) -> None:
        machine = Machine(
            nome="Rettifica",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-12",
            startup_checklist=["Controllo protezioni"],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await delete_machine(machine.id, admin=self.admin, db=self.db)

        self.assertEqual(context.exception.status_code, 409)

    async def test_update_user_rejects_user_with_active_machine_session(self) -> None:
        machine = Machine(
            nome="Trapano Radiale",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-13",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await update_user(
                self.operator.id,
                UserUpdateRequest(nome="Operaio Nuovo"),
                admin=self.admin,
                db=self.db,
            )

        self.assertEqual(context.exception.status_code, 409)

    async def test_delete_user_rejects_user_with_active_machine_session(self) -> None:
        machine = Machine(
            nome="Centro CNC",
            department_id=self.department_id,
            reparto_legacy="Manutenzione",
            id_postazione="POST-14",
            startup_checklist=[],
            in_uso=True,
            operatore_attuale_id=self.operator.id,
        )
        self.db.add(machine)
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            await delete_user(self.operator.id, admin=self.admin, db=self.db)

        self.assertEqual(context.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()


