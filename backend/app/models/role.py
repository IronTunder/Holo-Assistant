import json

from sqlalchemy import Boolean, Column, Integer, String, Text
from app.database import Base

ALL_PERMISSIONS = [
    "backoffice.access",
    "users.manage",
    "roles.manage",
    "departments.manage",
    "machines.manage",
    "knowledge.manage",
    "logs.view",
    "maintenance.view",
    "emergencies.view",
    "interactions.resolve",
]

ADMIN_ROLE_CODE = "admin"
OPERATOR_ROLE_CODE = "operaio"
MAINTENANCE_TECH_ROLE_CODE = "tecnico-manutenzione"

SYSTEM_ROLE_DEFINITIONS = {
    ADMIN_ROLE_CODE: {
        "name": "Admin",
        "description": "Accesso completo alla console amministrativa.",
        "permissions": ALL_PERMISSIONS,
    },
    OPERATOR_ROLE_CODE: {
        "name": "Operaio",
        "description": "Accesso operativo alla postazione macchina.",
        "permissions": [],
    },
    MAINTENANCE_TECH_ROLE_CODE: {
        "name": "Tecnico Manutenzione",
        "description": "Gestione richieste di manutenzione, emergenze e risoluzione problemi.",
        "permissions": [
            "backoffice.access",
            "maintenance.view",
            "emergencies.view",
            "logs.view",
            "interactions.resolve",
        ],
    },
}


def normalize_permissions(value: list[str] | str | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed_value = json.loads(value)
        except json.JSONDecodeError:
            parsed_value = [item.strip() for item in value.split(",")]
    else:
        parsed_value = value

    permissions = []
    for permission in parsed_value:
        if not isinstance(permission, str):
            continue
        normalized_permission = permission.strip()
        if normalized_permission and normalized_permission not in permissions:
            permissions.append(normalized_permission)
    return permissions


class Role(Base):
    __tablename__ = "roles"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column("nome", String, nullable=False, unique=True)
    code = Column(String(64), nullable=True, unique=True, index=True)
    description = Column(Text, nullable=True)
    permissions_text = Column("permessi", Text, nullable=True)
    is_system = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    @property
    def permissions(self) -> list[str]:
        return normalize_permissions(self.permissions_text)

    @permissions.setter
    def permissions(self, value: list[str] | str | None) -> None:
        self.permissions_text = json.dumps(normalize_permissions(value))

    @property
    def nome(self) -> str:
        return self.name

    @nome.setter
    def nome(self, value: str) -> None:
        self.name = value

    @property
    def permessi(self) -> str | None:
        return self.permissions_text

    @permessi.setter
    def permessi(self, value: list[str] | str | None) -> None:
        if isinstance(value, list):
            self.permissions = value
            return
        self.permissions_text = value
