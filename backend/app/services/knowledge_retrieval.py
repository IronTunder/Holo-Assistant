import logging
import re
import threading
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from time import perf_counter
from typing import Iterable, Sequence

from sqlalchemy.orm import Session, joinedload

from app.models.knowledge_item import KnowledgeItem, MachineKnowledgeItem
from app.services.ollama_service import (
    OllamaServiceError,
    generate_out_of_scope_response,
    rerank_knowledge_candidates,
    verify_knowledge_match,
)

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover - fallback only when dependency is missing
    fuzz = None

logger = logging.getLogger(__name__)

WORD_PATTERN = re.compile(r"\w+", re.UNICODE)
STOPWORDS = {
    "a",
    "ad",
    "ai",
    "al",
    "alla",
    "alle",
    "allo",
    "anche",
    "avere",
    "bene",
    "ce",
    "che",
    "chi",
    "ci",
    "come",
    "con",
    "cui",
    "da",
    "dal",
    "dalla",
    "dalle",
    "dallo",
    "devo",
    "dei",
    "del",
    "della",
    "delle",
    "dello",
    "di",
    "ed",
    "era",
    "essere",
    "fa",
    "faccio",
    "fare",
    "farmi",
    "fatto",
    "gli",
    "ha",
    "hai",
    "hanno",
    "ho",
    "i",
    "il",
    "in",
    "io",
    "la",
    "le",
    "lei",
    "li",
    "lo",
    "loro",
    "lui",
    "ma",
    "me",
    "meno",
    "mi",
    "mio",
    "mia",
    "mie",
    "miei",
    "molto",
    "ne",
    "nei",
    "nel",
    "nella",
    "nelle",
    "nello",
    "noi",
    "non",
    "nostro",
    "nostra",
    "o",
    "ogni",
    "ogniun",
    "per",
    "piu",
    "poi",
    "po",
    "puo",
    "puoi",
    "qua",
    "quale",
    "quanta",
    "quante",
    "quanti",
    "quello",
    "questa",
    "queste",
    "questi",
    "questo",
    "saranno",
    "sarebbe",
    "sarebbero",
    "serve",
    "servono",
    "se",
    "sei",
    "si",
    "sia",
    "sono",
    "sta",
    "sto",
    "su",
    "sua",
    "sue",
    "suo",
    "suoi",
    "tra",
    "trova",
    "trovare",
    "trovo",
    "tu",
    "tua",
    "tuo",
    "un",
    "una",
    "uno",
    "usa",
    "usare",
    "uso",
    "vi",
    "voi",
}
TECHNICAL_HINT_WORDS = {
    "allarme",
    "alimentazione",
    "arresto",
    "asse",
    "assi",
    "avvia",
    "avvio",
    "blocco",
    "bulloni",
    "calibra",
    "calibrare",
    "calibro",
    "cinghia",
    "cinghie",
    "controllo",
    "cuscinetti",
    "display",
    "dpi",
    "emergenza",
    "errore",
    "fermo",
    "firmware",
    "filtro",
    "filtri",
    "guasto",
    "guanti",
    "incastro",
    "interruttori",
    "livello",
    "lubrificare",
    "lubrificazione",
    "macchina",
    "macchinario",
    "manutenzione",
    "motore",
    "olio",
    "parametri",
    "pannello",
    "plc",
    "pneumatica",
    "potenza",
    "pressione",
    "pressa",
    "procedura",
    "produzione",
    "protezione",
    "protezioni",
    "pulsante",
    "reset",
    "rumore",
    "rumori",
    "scarico",
    "sensore",
    "sensori",
    "sicurezza",
    "sostituire",
    "temperatura",
    "tornio",
    "trasmissione",
    "velocita",
    "verificare",
}
GENERIC_QUERY_TOKENS = {
    "aiuto",
    "controllo",
    "controlli",
    "corretta",
    "corretto",
    "giusta",
    "giusto",
    "macchina",
    "problema",
    "procedura",
    "qual",
    "quali",
    "tempo",
    "verifica",
}

FALLBACK_MESSAGE = (
    "Mi dispiace, non sono riuscito a trovare una risposta appropriata alla tua domanda. "
    "Ti consiglio di contattare direttamente l'assistenza per ricevere aiuto."
)
OUT_OF_SCOPE_MESSAGE = (
    "Non posso aiutarti su questa richiesta. Posso invece supportarti con domande tecniche su macchine, sicurezza e procedure di reparto."
)
CLARIFICATION_MESSAGE = "Ho trovato due procedure simili. Quale descrive meglio il problema?"
MIN_DIRECT_SCORE = 7.5
STRONG_MATCH_SCORE = 12.5
AMBIGUOUS_GAP = 3.5
AMBIGUOUS_RATIO = 0.88
TOKEN_SIMILARITY_MULTI = 0.9
TOKEN_SIMILARITY_SINGLE = 0.94
GLOBAL_DOMAIN_SIMILARITY = 0.9
MIN_FUZZY_PHRASE_CHARS = 5
EXPLICIT_OUT_OF_SCOPE_KEYWORDS = {
    "reich",
    "nazismo",
    "nazista",
    "hitler",
    "fascismo",
    "fascista",
    "terrorismo",
    "terrorista",
    "bomba",
    "ordigno",
    "omicidio",
    "uccidere",
    "ammazzare",
    "droga",
    "stupefacenti",
    "porno",
    "poesia",
    "meteo",
    "weather",
    "elezioni",
    "politica",
    "partito",
}
EXPLICIT_OUT_OF_SCOPE_PATTERNS = (
    "4 reich",
    "quarto reich",
    "fondare il reich",
    "come posso fondare",
    "scrivimi una poesia",
    "che tempo fa",
)


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text or "")
    ascii_only = "".join(char for char in normalized if not unicodedata.combining(char))
    collapsed = re.sub(r"[^a-zA-Z0-9]+", " ", ascii_only.lower()).strip()
    return re.sub(r"\s+", " ", collapsed)


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in WORD_PATTERN.findall(_normalize_text(text))
        if len(token) >= 2 and token not in STOPWORDS
    }


def _tokenize_all(text: str) -> tuple[str, ...]:
    return tuple(token for token in WORD_PATTERN.findall(_normalize_text(text)) if len(token) >= 2)


def _stem_token(token: str) -> str:
    if len(token) < 5:
        return token
    if token.endswith(("i", "e", "o", "a")):
        return token[:-1]
    return token


def _stem_tokens(tokens: Iterable[str]) -> frozenset[str]:
    return frozenset(_stem_token(token) for token in tokens if token)


def _is_fuzzy_generic_token(token: str) -> bool:
    if token in GENERIC_QUERY_TOKENS:
        return True
    return any(
        _fuzzy_similarity(token, generic_token, allow_partial=False) >= 0.88
        for generic_token in GENERIC_QUERY_TOKENS
    )


def _split_question_tokens(question_tokens: set[str]) -> tuple[set[str], set[str]]:
    generic_tokens = {token for token in question_tokens if _is_fuzzy_generic_token(token)}
    specific_tokens = question_tokens - generic_tokens
    return specific_tokens, generic_tokens


def _split_keywords(raw_keywords: str | None) -> tuple[str, ...]:
    if not raw_keywords:
        return ()
    parts = [_normalize_text(part) for part in re.split(r"[,;\n]+", raw_keywords)]
    return tuple(part for part in parts if part)


def _split_example_questions(raw_examples: str | None) -> tuple[str, ...]:
    if not raw_examples:
        return ()
    lines = [_normalize_text(line) for line in raw_examples.splitlines()]
    return tuple(line for line in lines if line)


def _fuzzy_similarity(left: str, right: str, *, allow_partial: bool = True) -> float:
    if not left or not right:
        return 0.0
    if fuzz is not None:
        scores = [fuzz.ratio(left, right)]
        if allow_partial:
            scores.append(fuzz.partial_ratio(left, right))
        return max(scores) / 100.0

    scores = [SequenceMatcher(None, left, right).ratio()]
    if allow_partial and len(right) > len(left):
        scores.append(SequenceMatcher(None, left, right[: len(left)]).ratio())
    return max(scores)


def _token_similarity_details(question_tokens: Iterable[str], candidate_tokens: Iterable[str]) -> tuple[float, int]:
    candidate_tokens = tuple(candidate_tokens)
    if not candidate_tokens:
        return 0.0, 0

    best_score = 0.0
    strong_matches = 0
    for question_token in question_tokens:
        token_best = 0.0
        for candidate_token in candidate_tokens:
            token_best = max(
                token_best,
                _fuzzy_similarity(question_token, candidate_token, allow_partial=False),
            )
        best_score = max(best_score, token_best)
        if token_best >= TOKEN_SIMILARITY_MULTI:
            strong_matches += 1
    return best_score, strong_matches


def _count_phrase_matches(question_normalized: str, phrases: Iterable[str]) -> int:
    matches = 0
    for phrase in phrases:
        if not phrase or len(phrase) < 3:
            continue
        if re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", question_normalized):
            matches += 1
    return matches


def _contains_explicit_out_of_scope_content(question_normalized: str, question_tokens: set[str]) -> bool:
    if any(pattern in question_normalized for pattern in EXPLICIT_OUT_OF_SCOPE_PATTERNS):
        return True
    return any(token in EXPLICIT_OUT_OF_SCOPE_KEYWORDS for token in question_tokens)


@dataclass(frozen=True)
class IndexedKnowledgeItem:
    id: int
    category_id: int
    category_name: str | None
    question_title: str
    answer_text: str
    keywords: str | None
    example_questions: str | None
    knowledge_item_id: int
    knowledge_item_title: str
    sort_order: int
    normalized_title: str
    normalized_answer: str
    normalized_examples: tuple[str, ...]
    title_tokens: frozenset[str]
    answer_tokens: frozenset[str]
    keyword_tokens: frozenset[str]
    example_tokens: frozenset[str]
    title_roots: frozenset[str]
    answer_roots: frozenset[str]
    keyword_roots: frozenset[str]
    example_roots: frozenset[str]
    keyword_phrases: tuple[str, ...]
    example_phrases: tuple[str, ...]
    answer_token_count: int
    technical_tokens: frozenset[str]
    specific_tokens: frozenset[str]
    specific_roots: frozenset[str]

    @classmethod
    def from_model(cls, item: KnowledgeItem) -> "IndexedKnowledgeItem":
        keyword_phrases = _split_keywords(item.keywords)
        example_phrases = _split_example_questions(item.example_questions)
        answer_tokens = _tokenize(item.answer_text)
        title_tokens = _tokenize(item.question_title)
        keyword_tokens = _tokenize(item.keywords or "")
        example_tokens = _tokenize(item.example_questions or "")
        technical_tokens = frozenset(title_tokens | keyword_tokens | example_tokens)
        specific_tokens = frozenset(token for token in technical_tokens if token not in GENERIC_QUERY_TOKENS)
        return cls(
            id=item.id,
            category_id=item.category_id,
            category_name=item.category.name if item.category else None,
            question_title=item.question_title,
            answer_text=item.answer_text,
            keywords=item.keywords,
            example_questions=item.example_questions,
            knowledge_item_id=item.id,
            knowledge_item_title=item.question_title,
            sort_order=item.sort_order,
            normalized_title=_normalize_text(item.question_title),
            normalized_answer=_normalize_text(item.answer_text),
            normalized_examples=example_phrases,
            title_tokens=frozenset(title_tokens),
            answer_tokens=frozenset(answer_tokens),
            keyword_tokens=frozenset(keyword_tokens),
            example_tokens=frozenset(example_tokens),
            title_roots=_stem_tokens(title_tokens),
            answer_roots=_stem_tokens(answer_tokens),
            keyword_roots=_stem_tokens(keyword_tokens),
            example_roots=_stem_tokens(example_tokens),
            keyword_phrases=keyword_phrases,
            example_phrases=example_phrases,
            answer_token_count=len(answer_tokens),
            technical_tokens=technical_tokens,
            specific_tokens=specific_tokens,
            specific_roots=_stem_tokens(specific_tokens),
        )

    def to_response_payload(self) -> dict:
        return {
            "id": self.id,
            "category_id": self.category_id,
            "category_name": self.category_name,
            "question_title": self.question_title,
            "text": self.answer_text,
            "answer_text": self.answer_text,
            "keywords": self.keywords,
            "example_questions": self.example_questions,
            "knowledge_item_id": self.knowledge_item_id,
            "knowledge_item_title": self.knowledge_item_title,
        }

    def to_clarification_option(self) -> dict:
        label = self.question_title
        if self.category_name:
            label = f"{label} ({self.category_name})"
        return {
            "knowledge_item_id": self.knowledge_item_id,
            "label": label,
            "category_name": self.category_name,
        }

    def to_rerank_prompt_candidate(self) -> dict:
        return {
            "knowledge_item_id": self.knowledge_item_id,
            "question_title": self.question_title,
            "category_name": self.category_name,
            "keywords": self.keywords,
            "example_questions": self.example_questions,
            "answer_text": self.answer_text,
        }


@dataclass(frozen=True)
class ScoredKnowledgeCandidate:
    item: IndexedKnowledgeItem
    score: float
    exact_keyword_matches: int
    keyword_overlap: int
    title_overlap: int
    example_overlap: int
    answer_overlap: int
    root_overlap: int
    fuzzy_score: float
    best_token_similarity: float
    strong_technical_matches: int


@dataclass(frozen=True)
class RetrievalResult:
    mode: str
    response: str
    confidence: float
    response_payload: dict | None
    clarification_options: list[dict]
    route: str
    reason_code: str
    top_candidates: list[ScoredKnowledgeCandidate]
    ollama_latency_ms: float | None = None


class KnowledgeRetrievalService:
    def __init__(self) -> None:
        self._machine_cache: dict[int, tuple[IndexedKnowledgeItem, ...]] = {}
        self._lock = threading.RLock()

    def invalidate_machine(self, machine_id: int) -> None:
        with self._lock:
            self._machine_cache.pop(machine_id, None)

    def invalidate_machines(self, machine_ids: Iterable[int]) -> None:
        with self._lock:
            for machine_id in set(machine_ids):
                self._machine_cache.pop(machine_id, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._machine_cache.clear()

    def get_machine_knowledge(self, db: Session, machine_id: int) -> tuple[IndexedKnowledgeItem, ...]:
        with self._lock:
            cached = self._machine_cache.get(machine_id)
        if cached is not None:
            return cached

        knowledge_items = (
            db.query(KnowledgeItem)
            .join(MachineKnowledgeItem, MachineKnowledgeItem.knowledge_item_id == KnowledgeItem.id)
            .options(joinedload(KnowledgeItem.category))
            .filter(
                MachineKnowledgeItem.machine_id == machine_id,
                MachineKnowledgeItem.is_enabled.is_(True),
                KnowledgeItem.is_active.is_(True),
            )
            .order_by(KnowledgeItem.sort_order.asc(), KnowledgeItem.id.asc())
            .all()
        )
        indexed = tuple(IndexedKnowledgeItem.from_model(item) for item in knowledge_items)
        with self._lock:
            self._machine_cache[machine_id] = indexed
        return indexed

    def _machine_domain_vocabulary(self, candidates: Sequence[IndexedKnowledgeItem]) -> frozenset[str]:
        vocabulary = set(TECHNICAL_HINT_WORDS)
        for candidate in candidates:
            vocabulary.update(candidate.specific_tokens)
            vocabulary.update(candidate.answer_tokens)
        return frozenset(token for token in vocabulary if len(token) >= 3)

    def _is_generic_ambiguous_query(
        self,
        question_tokens: set[str],
        specific_question_tokens: set[str],
    ) -> bool:
        if not question_tokens or specific_question_tokens:
            return False
        return any(_is_fuzzy_generic_token(token) for token in question_tokens)

    def _detect_query_scope(
        self,
        question: str,
        question_tokens: set[str],
        all_words: Sequence[str],
        machine_vocabulary: frozenset[str],
    ) -> tuple[bool, dict]:
        question_normalized = _normalize_text(question)
        explicit_out_of_scope = _contains_explicit_out_of_scope_content(question_normalized, question_tokens)
        raw_word_count = max(len(all_words), 1)
        stopword_count = sum(1 for token in all_words if token in STOPWORDS)
        stopword_ratio = stopword_count / raw_word_count
        specific_question_tokens, generic_question_tokens = _split_question_tokens(question_tokens)
        generic_overlap = generic_question_tokens & GENERIC_QUERY_TOKENS
        domain_overlap = specific_question_tokens & machine_vocabulary
        _, strong_domain_matches = _token_similarity_details(specific_question_tokens, machine_vocabulary)
        hint_overlap = specific_question_tokens & TECHNICAL_HINT_WORDS
        is_generic_query = not specific_question_tokens and bool(generic_question_tokens)
        is_out_of_scope = False
        if explicit_out_of_scope:
            is_out_of_scope = True
        elif not is_generic_query:
            is_out_of_scope = (
                not domain_overlap
                and not hint_overlap
                and strong_domain_matches == 0
                and (
                    raw_word_count == 1
                    or len(question_tokens) == 1
                    or len(specific_question_tokens) == 0
                    or len(question_tokens) >= 2
                    or stopword_ratio >= 0.35
                    or raw_word_count >= 6
                )
            )
        return is_out_of_scope, {
            "explicit_out_of_scope": explicit_out_of_scope,
            "stopword_ratio": round(stopword_ratio, 3),
            "domain_overlap_count": len(domain_overlap),
            "strong_domain_matches": strong_domain_matches,
            "hint_overlap_count": len(hint_overlap),
        }

    def score_candidates(
        self,
        question: str,
        candidates: Sequence[IndexedKnowledgeItem],
    ) -> list[ScoredKnowledgeCandidate]:
        question_normalized = _normalize_text(question)
        question_tokens = _tokenize(question)
        if not question_normalized or not question_tokens:
            return []

        scored: list[ScoredKnowledgeCandidate] = []
        is_single_token_query = len(question_tokens) == 1
        specific_question_tokens, generic_question_tokens = _split_question_tokens(question_tokens)
        specific_question_roots = _stem_tokens(specific_question_tokens)
        match_question_tokens = specific_question_tokens or generic_question_tokens or question_tokens
        match_question_roots = specific_question_roots or _stem_tokens(question_tokens)
        for candidate in candidates:
            exact_keyword_matches = _count_phrase_matches(question_normalized, candidate.keyword_phrases)
            exact_example_matches = _count_phrase_matches(question_normalized, candidate.example_phrases)
            keyword_overlap = len(match_question_tokens & candidate.keyword_tokens)
            title_overlap = len(match_question_tokens & candidate.title_tokens)
            example_overlap = len(match_question_tokens & candidate.example_tokens)
            answer_overlap = len(question_tokens & candidate.answer_tokens)
            root_overlap = len(match_question_roots & (candidate.specific_roots or _stem_tokens(candidate.technical_tokens)))

            fuzzy_inputs = [
                candidate.normalized_title,
                *[phrase for phrase in candidate.keyword_phrases[:3] if len(phrase) >= MIN_FUZZY_PHRASE_CHARS],
                *[phrase for phrase in candidate.normalized_examples[:3] if len(phrase) >= MIN_FUZZY_PHRASE_CHARS],
            ]
            fuzzy_score = max(
                (
                    _fuzzy_similarity(
                        question_normalized,
                        value,
                        allow_partial=not is_single_token_query,
                    )
                    for value in fuzzy_inputs
                    if value
                ),
                default=0.0,
            )
            best_token_similarity, strong_technical_matches = _token_similarity_details(
                match_question_tokens,
                candidate.technical_tokens if not specific_question_tokens else (candidate.specific_tokens or candidate.technical_tokens),
            )

            has_exact_evidence = exact_keyword_matches > 0 or exact_example_matches > 0
            has_overlap_evidence = keyword_overlap > 0 or title_overlap > 0 or example_overlap > 0 or root_overlap > 0
            has_similarity_evidence = (
                strong_technical_matches >= 2
                or root_overlap > 0
                or (is_single_token_query and best_token_similarity >= TOKEN_SIMILARITY_SINGLE)
                or (not specific_question_tokens and strong_technical_matches >= 1 and best_token_similarity >= TOKEN_SIMILARITY_MULTI)
            )
            if not (has_exact_evidence or has_overlap_evidence or has_similarity_evidence):
                continue

            score = 0.0
            score += exact_keyword_matches * 18.0
            score += exact_example_matches * 14.0
            score += keyword_overlap * 8.0
            score += title_overlap * 6.0
            score += example_overlap * 6.0
            score += answer_overlap * 0.75
            score += root_overlap * 5.5
            score += fuzzy_score * 3.5
            score += best_token_similarity * 5.0
            score += strong_technical_matches * 4.0

            if question_normalized == candidate.normalized_title:
                score += 12.0
            elif question_normalized in candidate.normalized_title and len(question_tokens) >= 2:
                score += 4.0

            if candidate.answer_token_count > 60 and answer_overlap == 0 and not has_overlap_evidence:
                score -= min(candidate.answer_token_count / 60.0, 2.0)

            scored.append(
                ScoredKnowledgeCandidate(
                    item=candidate,
                    score=round(score, 3),
                    exact_keyword_matches=exact_keyword_matches + exact_example_matches,
                    keyword_overlap=keyword_overlap,
                    title_overlap=title_overlap,
                    example_overlap=example_overlap,
                    answer_overlap=answer_overlap,
                    root_overlap=root_overlap,
                    fuzzy_score=round(fuzzy_score, 3),
                    best_token_similarity=round(best_token_similarity, 3),
                    strong_technical_matches=strong_technical_matches,
                )
            )

        scored.sort(
            key=lambda candidate: (
                candidate.score,
                candidate.exact_keyword_matches,
                candidate.keyword_overlap + candidate.example_overlap + candidate.root_overlap,
                candidate.title_overlap,
                candidate.strong_technical_matches,
                candidate.answer_overlap,
                -candidate.item.sort_order,
                -candidate.item.id,
            ),
            reverse=True,
        )
        return scored

    def _build_confidence(
        self,
        top_candidate: ScoredKnowledgeCandidate,
        second_candidate: ScoredKnowledgeCandidate | None,
    ) -> float:
        confidence = min(top_candidate.score / 22.0, 0.72)
        if top_candidate.exact_keyword_matches > 0:
            confidence += 0.12
        if top_candidate.keyword_overlap + top_candidate.example_overlap + top_candidate.root_overlap >= 1:
            confidence += 0.08
        if top_candidate.title_overlap >= 1:
            confidence += 0.05
        if top_candidate.strong_technical_matches >= 2:
            confidence += 0.08

        if second_candidate is None:
            confidence += 0.1
        elif top_candidate.score > 0:
            gap_ratio = max(top_candidate.score - second_candidate.score, 0.0) / top_candidate.score
            confidence += min(gap_ratio * 0.2, 0.15)

        return round(max(0.0, min(confidence, 0.99)), 3)

    def _should_request_clarification(
        self,
        top_candidate: ScoredKnowledgeCandidate,
        second_candidate: ScoredKnowledgeCandidate | None,
        confidence: float,
    ) -> bool:
        if second_candidate is None:
            return False

        if (
            second_candidate.strong_technical_matches < 2
            and second_candidate.keyword_overlap + second_candidate.example_overlap + second_candidate.root_overlap == 0
        ):
            return False

        gap = top_candidate.score - second_candidate.score
        ratio = second_candidate.score / top_candidate.score if top_candidate.score else 1.0
        return (
            confidence < 0.8
            and gap < AMBIGUOUS_GAP
            and ratio >= AMBIGUOUS_RATIO
            and second_candidate.score >= MIN_DIRECT_SCORE
        )

    def _requires_llm_verification(
        self,
        top_candidate: ScoredKnowledgeCandidate,
        confidence: float,
    ) -> bool:
        anchored_overlap = (
            top_candidate.keyword_overlap
            + top_candidate.title_overlap
            + top_candidate.example_overlap
            + top_candidate.root_overlap
        )
        if top_candidate.exact_keyword_matches > 0:
            return False
        if anchored_overlap >= 2:
            return False
        if top_candidate.strong_technical_matches >= 2:
            return False
        return confidence < 0.9

    def _build_rerank_pool(self, scored_candidates: Sequence[ScoredKnowledgeCandidate]) -> list[ScoredKnowledgeCandidate]:
        if not scored_candidates:
            return []
        top_score = scored_candidates[0].score
        rerank_pool: list[ScoredKnowledgeCandidate] = []
        for candidate in scored_candidates[:5]:
            if len(rerank_pool) >= 3:
                break
            if candidate.score >= MIN_DIRECT_SCORE and (top_score - candidate.score <= 4.5 or candidate.score >= top_score * 0.82):
                rerank_pool.append(candidate)
        return rerank_pool

    def _find_selected_candidate(
        self,
        selected_knowledge_item_id: int,
        candidates: Sequence[IndexedKnowledgeItem],
    ) -> IndexedKnowledgeItem | None:
        for candidate in candidates:
            if candidate.knowledge_item_id == selected_knowledge_item_id:
                return candidate
        return None

    async def resolve_question(
        self,
        db: Session,
        machine_id: int,
        question: str,
        selected_knowledge_item_id: int | None = None,
    ) -> RetrievalResult:
        indexed_candidates = self.get_machine_knowledge(db, machine_id)
        if not indexed_candidates:
            return RetrievalResult(
                mode="fallback",
                response=FALLBACK_MESSAGE,
                confidence=0.0,
                response_payload=None,
                clarification_options=[],
                route="fallback_no_knowledge",
                reason_code="no_match",
                top_candidates=[],
            )

        if selected_knowledge_item_id is not None:
            selected_candidate = self._find_selected_candidate(selected_knowledge_item_id, indexed_candidates)
            if selected_candidate is None:
                return RetrievalResult(
                    mode="fallback",
                    response=FALLBACK_MESSAGE,
                    confidence=0.0,
                    response_payload=None,
                    clarification_options=[],
                    route="fallback_invalid_selection",
                    reason_code="no_match",
                    top_candidates=[],
                )
            return RetrievalResult(
                mode="answer",
                response=selected_candidate.answer_text,
                confidence=0.99,
                response_payload=selected_candidate.to_response_payload(),
                clarification_options=[],
                route="clarification_selected",
                reason_code="matched",
                top_candidates=[],
            )

        question_tokens = _tokenize(question)
        question_all_words = _tokenize_all(question)
        specific_question_tokens, _generic_question_tokens = _split_question_tokens(question_tokens)
        machine_vocabulary = self._machine_domain_vocabulary(indexed_candidates)
        is_out_of_scope, scope_details = self._detect_query_scope(
            question,
            question_tokens,
            question_all_words,
            machine_vocabulary,
        )
        if is_out_of_scope:
            out_of_scope_response = OUT_OF_SCOPE_MESSAGE
            ollama_latency_ms = None
            out_of_scope_start = perf_counter()
            try:
                out_of_scope_response = await generate_out_of_scope_response(question)
                ollama_latency_ms = round((perf_counter() - out_of_scope_start) * 1000, 2)
            except OllamaServiceError as exc:
                ollama_latency_ms = round((perf_counter() - out_of_scope_start) * 1000, 2)
                logger.warning(
                    "Ollama out-of-scope response unavailable for machine_id=%s question=%r: %s",
                    machine_id,
                    question,
                    exc,
                )
            logger.info(
                "interaction classified as out_of_scope machine_id=%s question=%r scope_details=%s",
                machine_id,
                question,
                scope_details,
            )
            return RetrievalResult(
                mode="fallback",
                response=out_of_scope_response,
                confidence=0.0,
                response_payload=None,
                clarification_options=[],
                route="fallback_out_of_scope",
                reason_code="out_of_scope",
                top_candidates=[],
                ollama_latency_ms=ollama_latency_ms,
            )

        scored_candidates = self.score_candidates(question, indexed_candidates)
        if not scored_candidates or scored_candidates[0].score < MIN_DIRECT_SCORE:
            return RetrievalResult(
                mode="fallback",
                response=FALLBACK_MESSAGE,
                confidence=0.0,
                response_payload=None,
                clarification_options=[],
                route="fallback_low_score",
                reason_code="no_match",
                top_candidates=scored_candidates[:3],
            )

        top_candidate = scored_candidates[0]
        second_candidate = scored_candidates[1] if len(scored_candidates) > 1 else None
        confidence = self._build_confidence(top_candidate, second_candidate)
        is_generic_ambiguous_query = self._is_generic_ambiguous_query(question_tokens, specific_question_tokens)

        if is_generic_ambiguous_query:
            generic_pool = [candidate for candidate in scored_candidates[:3] if candidate.score >= MIN_DIRECT_SCORE]
            if len(generic_pool) >= 2:
                return RetrievalResult(
                    mode="clarification",
                    response=CLARIFICATION_MESSAGE,
                    confidence=min(confidence, 0.6),
                    response_payload=None,
                    clarification_options=[candidate.item.to_clarification_option() for candidate in generic_pool[:2]],
                    route="clarification_generic_query",
                    reason_code="clarification",
                    top_candidates=scored_candidates[:3],
                )
            return RetrievalResult(
                mode="fallback",
                response=FALLBACK_MESSAGE,
                confidence=0.0,
                response_payload=None,
                clarification_options=[],
                route="fallback_generic_query",
                reason_code="no_match",
                top_candidates=scored_candidates[:3],
            )

        if not self._should_request_clarification(top_candidate, second_candidate, confidence):
            if self._requires_llm_verification(top_candidate, confidence):
                verification_start = perf_counter()
                try:
                    is_relevant = await verify_knowledge_match(
                        question,
                        top_candidate.item.to_rerank_prompt_candidate(),
                    )
                    verification_latency_ms = round((perf_counter() - verification_start) * 1000, 2)
                    if not is_relevant:
                        logger.info(
                            "retrieval rejected by ollama verification machine_id=%s question=%r knowledge_item_id=%s",
                            machine_id,
                            question,
                            top_candidate.item.knowledge_item_id,
                        )
                        return RetrievalResult(
                            mode="fallback",
                            response=FALLBACK_MESSAGE,
                            confidence=0.0,
                            response_payload=None,
                            clarification_options=[],
                            route="fallback_llm_rejected",
                            reason_code="no_match",
                            top_candidates=scored_candidates[:3],
                            ollama_latency_ms=verification_latency_ms,
                        )
                except OllamaServiceError as exc:
                    verification_latency_ms = round((perf_counter() - verification_start) * 1000, 2)
                    logger.warning(
                        "Ollama verification unavailable for machine_id=%s question=%r: %s",
                        machine_id,
                        question,
                        exc,
                    )
                    return RetrievalResult(
                        mode="fallback",
                        response=FALLBACK_MESSAGE,
                        confidence=0.0,
                        response_payload=None,
                        clarification_options=[],
                        route="fallback_llm_unavailable",
                        reason_code="no_match",
                        top_candidates=scored_candidates[:3],
                        ollama_latency_ms=verification_latency_ms,
                    )
            return RetrievalResult(
                mode="answer",
                response=top_candidate.item.answer_text,
                confidence=confidence,
                response_payload=top_candidate.item.to_response_payload(),
                clarification_options=[],
                route="retrieval_direct",
                reason_code="matched",
                top_candidates=scored_candidates[:3],
            )

        rerank_pool = self._build_rerank_pool(scored_candidates)
        if len(rerank_pool) < 2:
            return RetrievalResult(
                mode="fallback",
                response=FALLBACK_MESSAGE,
                confidence=0.0,
                response_payload=None,
                clarification_options=[],
                route="fallback_ambiguous_weak",
                reason_code="no_match",
                top_candidates=scored_candidates[:3],
            )

        ollama_latency_ms = None
        prompt_candidates = [candidate.item.to_rerank_prompt_candidate() for candidate in rerank_pool]
        rerank_start = perf_counter()
        try:
            reranked_index = await rerank_knowledge_candidates(question, prompt_candidates)
            ollama_latency_ms = round((perf_counter() - rerank_start) * 1000, 2)
            reranked_candidate = rerank_pool[reranked_index]
            reranked_confidence = max(
                self._build_confidence(
                    reranked_candidate,
                    top_candidate if reranked_candidate != top_candidate else second_candidate,
                ),
                0.74,
            )
            if reranked_confidence >= 0.8:
                return RetrievalResult(
                    mode="answer",
                    response=reranked_candidate.item.answer_text,
                    confidence=reranked_confidence,
                    response_payload=reranked_candidate.item.to_response_payload(),
                    clarification_options=[],
                    route="ollama_rerank",
                    reason_code="matched",
                    top_candidates=scored_candidates[:3],
                    ollama_latency_ms=ollama_latency_ms,
                )
        except OllamaServiceError as exc:
            ollama_latency_ms = round((perf_counter() - rerank_start) * 1000, 2)
            logger.warning("Ollama rerank unavailable for machine_id=%s question=%r: %s", machine_id, question, exc)

        return RetrievalResult(
            mode="clarification",
            response=CLARIFICATION_MESSAGE,
            confidence=min(confidence, 0.74),
            response_payload=None,
            clarification_options=[candidate.item.to_clarification_option() for candidate in rerank_pool[:2]],
            route="clarification",
            reason_code="clarification",
            top_candidates=scored_candidates[:3],
            ollama_latency_ms=ollama_latency_ms,
        )


knowledge_retrieval_service = KnowledgeRetrievalService()
