import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.interactions import ask_question
from app.database import Base
from app.models.category import Category
from app.models.department import Department
from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.models.machine import Machine
from app.models.user import LivelloEsperienza, Ruolo, Turno, User
from app.schemas.interaction import AskQuestionRequest
from app.services.knowledge_retrieval import (
    IndexedKnowledgeItem,
    RetrievalResult,
    knowledge_retrieval_service,
)


class InteractionAiTestCase(unittest.IsolatedAsyncioTestCase):
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
        knowledge_retrieval_service.invalidate_all()

    def tearDown(self) -> None:
        self.db.close()
        Base.metadata.drop_all(bind=self.engine)
        self.engine.dispose()
        knowledge_retrieval_service.invalidate_all()

    def _seed_fixture(self) -> None:
        department = Department(name="Assemblaggio", code="assemblaggio", is_active=True)
        machine = Machine(
            nome="Pressa A7",
            department=department,
            reparto_legacy="Assemblaggio",
            descrizione="Pressa di test",
            id_postazione="A7",
            in_uso=False,
        )
        user = User(
            nome="Mario Rossi",
            badge_id="12345",
            password_hash="hash",
            ruolo=Ruolo.OPERAIO,
            livello_esperienza=LivelloEsperienza.OPERAIO,
            department=department,
            reparto_legacy="Assemblaggio",
            turno=Turno.MATTINA,
        )
        manutenzione = Category(name="Manutenzione", description="Procedure di manutenzione")
        sicurezza = Category(name="Sicurezza", description="Procedure di sicurezza")
        items = [
            KnowledgeItem(
                category=manutenzione,
                question_title="Cambio olio pressa",
                answer_text="Per cambiare l'olio spegni la pressa e scarica il serbatoio.",
                keywords="olio, cambio olio, lubrificazione",
                example_questions="Come cambio l'olio della pressa?\nDevo sostituire l'olio macchina",
                is_active=True,
                sort_order=1,
            ),
            KnowledgeItem(
                category=manutenzione,
                question_title="Sostituzione cinghia trasmissione",
                answer_text="Per sostituire la cinghia allenta il motore e monta la nuova.",
                keywords="cinghia, trasmissione, sostituzione",
                example_questions="La cinghia e rovinata\nCome cambio la cinghia di trasmissione?",
                is_active=True,
                sort_order=2,
            ),
            KnowledgeItem(
                category=manutenzione,
                question_title="Rumori anomali macchina",
                answer_text="Se senti rumori anomali controlla cuscinetti, bulloni e lubrificazione degli assi.",
                keywords="rumori, rumore, cuscinetti, bulloni",
                example_questions="La macchina fa un rumore strano\nSento rumori anomali durante il ciclo",
                is_active=True,
                sort_order=3,
            ),
            KnowledgeItem(
                category=sicurezza,
                question_title="Arresto di emergenza",
                answer_text="Premi il pulsante rosso di emergenza e allontanati dalla macchina.",
                keywords="emergenza, arresto, pulsante rosso",
                example_questions="Dove si trova l'arresto di emergenza?\nCome fermo subito la macchina?",
                is_active=True,
                sort_order=4,
            ),
        ]

        self.db.add_all([department, machine, user, manutenzione, sicurezza, *items])
        self.db.flush()
        self.db.add_all(
            [
                MachineKnowledgeItem(machine_id=machine.id, knowledge_item_id=item.id, is_enabled=True)
                for item in items
            ]
        )
        self.db.commit()

        self.machine_id = machine.id
        self.user_id = user.id
        self.item_ids = {item.question_title: item.id for item in items}

    async def test_ranking_prefers_exact_keyword_match(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Come faccio il cambio olio della pressa?",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Cambio olio pressa")

    async def test_ranking_handles_light_typo_with_fuzzy_score(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Devo cambiare la cingia di trasmisione",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Sostituzione cinghia trasmissione")

    async def test_ranking_matches_example_questions(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "Come fermo subito la macchina?",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Arresto di emergenza")

    async def test_ranking_matches_singular_plural_variant(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "rumore",
            indexed_candidates,
        )

        self.assertGreater(len(scored), 0)
        self.assertEqual(scored[0].item.question_title, "Rumori anomali macchina")

    async def test_ranking_rejects_single_word_out_of_domain_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "roblox",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ranking_rejects_multiword_out_of_domain_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "napoli juve aperol",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ranking_rejects_long_narrative_query(self) -> None:
        indexed_candidates = knowledge_retrieval_service.get_machine_knowledge(self.db, self.machine_id)

        scored = knowledge_retrieval_service.score_candidates(
            "se ni mondo esistesse un po di bene e ogniun si considerassse suo fratello ci sarebbero meno pensieri e meno pene ed il mondo ne sarebbe assai piu bello",
            indexed_candidates,
        )

        self.assertEqual(scored, [])

    async def test_ask_question_returns_answer_mode(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come faccio il cambio olio della pressa?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_title, "Cambio olio pressa")
        self.assertGreater(response.confidence, 0.7)

    async def test_ask_question_returns_clarification_mode(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Qual e la procedura giusta?",
        )
        clarification_result = RetrievalResult(
            mode="clarification",
            response="Ho trovato due procedure simili. Quale descrive meglio il problema?",
            confidence=0.61,
            response_payload=None,
            clarification_options=[
                {"knowledge_item_id": self.item_ids["Cambio olio pressa"], "label": "Cambio olio pressa (Manutenzione)"},
                {"knowledge_item_id": self.item_ids["Sostituzione cinghia trasmissione"], "label": "Sostituzione cinghia trasmissione (Manutenzione)"},
            ],
            route="clarification",
            reason_code="clarification",
            top_candidates=[],
        )

        with patch(
            "app.api.interactions.knowledge_retrieval_service.resolve_question",
            new=AsyncMock(return_value=clarification_result),
        ):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertEqual(len(response.clarification_options), 2)
        self.assertEqual(response.clarification_options[0].knowledge_item_id, self.item_ids["Cambio olio pressa"])

    async def test_ask_question_returns_clarification_for_generic_problem_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Ho un problema alla macchina",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertGreaterEqual(len(response.clarification_options), 2)

    async def test_ask_question_returns_clarification_for_generic_problem_query_with_typo(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Ho un problema alla macchin",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "clarification")
        self.assertEqual(response.reason_code, "clarification")
        self.assertGreaterEqual(len(response.clarification_options), 2)

    async def test_selected_knowledge_item_shortcuts_to_expected_answer(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Serve un chiarimento",
            selected_knowledge_item_id=self.item_ids["Sostituzione cinghia trasmissione"],
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "answer")
        self.assertEqual(response.reason_code, "matched")
        self.assertEqual(response.knowledge_item_id, self.item_ids["Sostituzione cinghia trasmissione"])
        self.assertIn("cinghia", response.response.lower())

    async def test_ask_question_returns_fallback_when_no_match(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Come calibro il sensore di pressione?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "no_match")
        self.assertEqual(response.knowledge_item_id, None)

    async def test_ask_question_returns_fallback_for_out_of_domain_single_word(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="roblox",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_out_of_domain_multiword(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="napoli juve aperol",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.confidence, 0.0)
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_long_narrative_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="se ni mondo esistesse un po di bene e ogniun si considerassse suo fratello ci sarebbero meno pensieri e meno pene ed il mondo ne sarebbe assai piu bello",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_weather_query(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Che tempo fa domani a Milano?",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)

    async def test_ask_question_returns_fallback_for_poetry_request(self) -> None:
        request = AskQuestionRequest(
            machine_id=self.machine_id,
            user_id=self.user_id,
            question="Scrivimi una poesia",
        )

        with patch("app.api.interactions.session_event_bus.publish", new=AsyncMock()):
            response = await ask_question(request, db=self.db)

        self.assertEqual(response.mode, "fallback")
        self.assertEqual(response.reason_code, "out_of_scope")
        self.assertIsNone(response.knowledge_item_id)


class IndexedKnowledgeItemTestCase(unittest.TestCase):
    def test_indexed_item_builds_normalized_tokens(self) -> None:
        category = Category(id=1, name="Manutenzione")
        item = KnowledgeItem(
            id=7,
            category_id=1,
            category=category,
            question_title="Cambio olio pressa",
            answer_text="Spegni la macchina e scarica il serbatoio dell'olio.",
            keywords="olio, cambio olio",
            example_questions="Come cambio l'olio della pressa?\nDevo sostituire l'olio macchina",
            sort_order=1,
            is_active=True,
        )

        indexed = IndexedKnowledgeItem.from_model(item)

        self.assertIn("olio", indexed.keyword_tokens)
        self.assertIn("pressa", indexed.title_tokens)
        self.assertIn("macchina", indexed.example_tokens)
        self.assertEqual(indexed.knowledge_item_id, 7)


if __name__ == "__main__":
    unittest.main()
