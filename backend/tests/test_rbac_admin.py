import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.admin import (
    DepartmentRequest,
    RoleRequest,
    create_department,
    create_role,
    delete_department,
    list_departments_metadata,
    update_role,
)
from app.api.auth.auth import user_has_permission
from app.database import Base
from app.models.department import Department
from app.models.machine import Machine
from app.models.role import ADMIN_ROLE_CODE, ALL_PERMISSIONS, MAINTENANCE_TECH_ROLE_CODE, Role
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
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
        self.admin_role.permissions = ALL_PERMISSIONS
        self.tech_role = Role(
            name="Tecnico Manutenzione",
            code=MAINTENANCE_TECH_ROLE_CODE,
            description="Tecnici",
            is_system=True,
            is_active=True,
        )
        self.tech_role.permissions = [
            "backoffice.access",
            "maintenance.view",
            "emergencies.view",
            "logs.view",
            "interactions.resolve",
        ]
        self.operator_role = Role(
            name="Operaio",
            code="operaio",
            description="Operatore",
            is_system=True,
            is_active=True,
        )
        self.operator_role.permissions = []
        department = Department(name="Manutenzione", code="manutenzione", is_active=True)
        self.db.add_all([self.admin_role, self.tech_role, self.operator_role, department])
        self.db.flush()
        self.admin = User(
            nome="Admin",
            badge_id="ADMIN",
            password_hash="hash",
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
            password_hash="hash",
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
            password_hash="hash",
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


if __name__ == "__main__":
    unittest.main()
