"""Read and write one JSON object per line; message contents stay in process memory."""
from functools import lru_cache
import json
import re
import unicodedata
from pathlib import Path
import os
import sys
import tempfile

if os.name == 'nt':
    runtime_path = os.add_dll_directory(str(Path(sys.executable).parent))

import ctranslate2
import sentencepiece
from lingua import Language, LanguageDetectorBuilder

models = {}

# Capture the original spelling, including escapes, query parameters and fragments.
# Capturing the whole match lets re.split keep the addresses between prose segments.
domain_label = r"[^\W_](?:[\w-]{0,61}[^\W_])?"
link = re.compile(
    rf"""(?<![\w@])(
        (?:(?:[a-z][a-z0-9+.-]*:)?//|mailto:|tel:|sms:|magnet:|geo:|www\.)[^\s<>"“”]+
        |(?:[\w.!#$%&'*+/=?^{{}}|~-]+@)?(?:{domain_label}\.)+
          (?:xn--[a-z0-9-]+|[^\W\d_]{{2,63}})(?![\w-])
          (?::[0-9]+)?(?:[/?\#][^\s<>"“”]*)?
        |(?:localhost\b|\[[a-f0-9:]+\]|(?:\d{{1,3}}\.){{3}}\d{{1,3}})(?::[0-9]+)?(?:[/?\#][^\s<>"“”]*)?
    )""",
    re.IGNORECASE | re.VERBOSE,
)


def words(text):
    return re.findall(r"[^\W\d_]+", unicodedata.normalize("NFKC", text).casefold())


def load_model(folder, pair):
    model_dir = folder / "model"
    if pair == "en_pt":
        # O primeiro token de cada segmento seleciona a variante neste modelo OPUS.
        config_path = model_dir / "config.json"
        config = json.loads(config_path.read_text(encoding="utf8"))
        vocabulary = json.loads((model_dir / "shared_vocabulary.json").read_text(encoding="utf8"))
        if ">>pob<<" not in vocabulary:
            raise ValueError("Modelo incompatível com português do Brasil")
        if config.get("bos_token") != ">>pob<<" or config.get("add_source_bos") is not True:
            config.update(bos_token=">>pob<<", add_source_bos=True)
            with tempfile.TemporaryDirectory(dir=model_dir) as staging:
                staged_config = Path(staging) / "config.json"
                staged_config.write_text(json.dumps(config, indent=2) + "\n", encoding="utf8")
                os.replace(staged_config, config_path)

    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(folder / "sentencepiece.model"))
    engine = ctranslate2.Translator(str(model_dir), device="cpu", compute_type="int8", intra_threads=2)
    probes = {"en_pt": "Where is the bus stop?", "es_pt": "¿Dónde está la parada de autobús?"}
    if pair in probes:
        tokens = tokenizer.encode(probes[pair], out_type=str)
        result = engine.translate_batch([tokens], beam_size=3, max_decoding_length=128)[0]
        if not {"ônibus", "coletivo", "busão"}.intersection(words(tokenizer.decode(result.hypotheses[0]))):
            raise ValueError("Modelo não passou na verificação de português do Brasil")
    return tokenizer, engine


def incoming_language(text):
    evidence = re.sub(r"@\w+", " ", text)
    tokens = words(evidence)
    if not tokens:
        return None
    phrase = " ".join(tokens)
    if ({"vc", "vcs", "vamo", "bora", "blz", "vlw", "obg", "voce", "você", "nao", "não"} & set(tokens)
            or phrase in {"ok", "okay", "show", "top", "ola", "olá", "legal", "kkk", "sim"}):
        return None
    # Short greetings can be distinctive even with little statistical evidence.
    if phrase in {"hola", "gracias", "muchas gracias", "buenos días", "buenas noches"}:
        return "es"
    if phrase in {"hi", "hello", "thanks", "thank you", "good morning", "yes"}:
        return "en"
    scores = detector.compute_language_confidence_values(phrase)
    best = scores[0]
    threshold = 0.85 if len(tokens) < 3 else 0.78
    if best.value < threshold:
        return None
    return {Language.ENGLISH: "en", Language.SPANISH: "es"}.get(best.language)


# For outgoing English, interpret an unqualified request for "valores" as a
# pricing request. Leave accounting, spreadsheet and company values to the model.
value_term = re.compile(r"\bvalor(?:es)?\b", re.I)
pricing_context = re.compile(
    r"\b(?:cotaç(?:ão|ões)|orçamentos?|precificaç[ãa]o|frete|cachê|campanha|diárias?|"
    r"por hora|por dia|comercial|negociar|preços?|tarifas?|hospedagem|serviços? prestados|tabela de valores|"
    r"valor(?:es)? (?:atualizad[oa]s? )?(?:d[oa]s?|para|por) "
    r"(?:(?:[oa]s?|esse|este|essa|esta|cada) )?(?:projetos?|trabalhos?|serviços?|entregas?|campanhas?))\b", re.I)
pricing_request = re.compile(
    r"\b(?:quais?(?:\s+(?:é|são|seriam?))?|qual(?:\s+(?:é|seria))?|"
    r"(?:pode(?:ria)?m?\s+)?(?:me\s+)?(?:manda\w*|envi\w*|pass\w*|inform\w*|compartilh\w*|confirm\w*)|"
    r"preciso|seguem?|confira|consulte|gostaria de saber)\s+(?:(?:d?[oa]s?|seus?|suas?|novos?)\s+)*valor(?:es)?"
    r"(?=$|[\s,]*por favor\b|[.,:;!?]|\s+(?:atualizad[oa]s?|abaixo|acima|até|hoje|amanhã|por enquanto)\b)", re.I)
non_rate_context = re.compile(
    r"\b(?:integridade|éticos?|morais|culturais|institucionais|pessoais|princípios|missão|"
    r"corporativos|familiares|nutricionais|numéricos|absolutos|variáveis|referência|planilhas?|células?|colunas?|parâmetros?|"
    r"faturas?|impostos?|saldos?|totais|total|reembolso|pagamentos?|investimentos?|"
    r"valor (?:agregado|de mercado|presente|futuro)|valores (?:da|de uma|de nossa) empresa)\b", re.I)
business_phrases = {
    "fico no aguardo do seu retorno": "I look forward to hearing from you",
    "aguardo seu retorno": "I look forward to your response",
    "aguardamos seu retorno": "We look forward to your response",
    "agradeço desde já pela atenção": "Thank you in advance for your consideration",
    "ficamos à disposição para esclarecer quaisquer dúvidas": "We are available to answer any questions",
    "precisamos alinhar os próximos passos": "We need to agree on the next steps",
}
# Fixed commercial expressions also apply inside a longer message. An explicitly
# saved phrase takes precedence over the built-in wording.
commercial_terms = {
    "a segunda via do boleto": "a copy of the payment slip",
    "segunda via do boleto": "copy of the payment slip",
    "segunda via dos boletos": "copies of the payment slips",
    "pagamento não é à vista": "payment is not due upfront",
    "pagamento é à vista": "payment is due in full upfront",
    "pagamento à vista": "upfront payment",
    "o vencimento do boleto é": "the payment slip is due",
    "o boleto vence": "the payment slip is due",
    "a cobrança vence": "payment is due",
    "dias corridos": "calendar days",
    "dia corrido": "calendar day",
    "boleto": "payment slip",
    "boletos": "payment slips",
}
clause_break = re.compile(r"[.!?;,\n]|\s+(?:mas|enquanto|e(?=\s+(?:d?[oa]s?\s+)?valor(?:es)?\b))\s+", re.I)


def pricing_at(line, hit):
    start, end = 0, len(line)
    for gap in clause_break.finditer(line):
        if gap.end() <= hit.start():
            start = gap.end()
        elif gap.start() >= hit.end():
            end = gap.start()
            break
    clause = line[start:end].strip()
    return not non_rate_context.search(clause) and (
        pricing_context.search(clause) or pricing_request.search(clause)
        or re.fullmatch(r"(?:(?:os?|esses?|estes?) )?valor(?:es)?(?: atualizad[oa]s?)?", clause, re.I))
abbreviation = re.compile(r"(?:\b(?:sr|sra|dr|dra|prof|pág|ref|av|ex)|\b[A-Z])\.$", re.I)
request_in_english = re.compile(r"^Can you (?=(?:send|share|confirm|provide|review|forward|check|update)\b)")

def business_sentence(sentence, infer):
    plain = sentence.rstrip(".!?")
    punctuation = sentence[len(plain):]
    key = plain.strip().casefold()
    if key in business_phrases:
        return business_phrases[key] + punctuation
    if key in ("valor", "valores"):
        term = "rate" if key == "valor" else "rates"
        return (term.capitalize() if plain[:1].isupper() else term) + punctuation
    pricing = value_term.search(sentence) and not non_rate_context.search(sentence) and (
        pricing_context.search(sentence) or pricing_request.search(sentence)
        or re.fullmatch(r"(?:(?:o|os|esse|esses|este|estes) )?valor(?:es)?(?: atualizad[oa]s?| (?:não |já )?(?:mudou|mudaram)| (?:abaixo|acima)| por favor)?", key))
    source = sentence
    if pricing:
        source = value_term.sub(lambda m: "tarifas" if m[0].lower() == "valores" else "tarifa", source)
    source = re.sub(r"\bvcs?\b", lambda m: "vocês" if m[0].lower()=="vcs" else "você", source, flags=re.I)
    source = re.sub(r"\bme dar (?:um|seu) retorno sobre\b", "me responder sobre", source, flags=re.I)
    source = re.sub(r"\bcobrando um retorno d([oa])\b", r"solicitando uma atualização a\1", source, flags=re.I)
    result = infer(source)
    if pricing and not re.search(r"\b(?:tarifas?|taxas?|honorários?|passagens?)\b", sentence, re.I):
        result = re.sub(r"\b(?:tariff|fee|fare)(s?)\b",
                        lambda m: ("Rate" if m[0][0].isupper() else "rate") + m[1], result, flags=re.I)
    if source != sentence and re.search(r"\bme dar (?:um|seu) retorno sobre\b", sentence, re.I):
        result = re.sub(r"\banswer me about\b", "get back to me about", result, flags=re.I)
    if re.search(r"\bem anexo\b", sentence, re.I) and not re.search(r"\babaixo\b", sentence, re.I):
        result = re.sub(r"\battached below\b", "attached", result, flags=re.I)
    if pricing and not re.search(r"\b(?:cobranças?|faturamentos?)\b", sentence, re.I):
        result = re.sub(r"\bbillings\b", "rates", result, flags=re.I)
    if pricing and re.match(r"^segue a tabela de valores", sentence, re.I):
        result = re.sub(r"^Follows the rate table(?: of the services)?",
                        lambda m: "Here is the service rate sheet" if "services" in m[0] else "Here is the rate sheet", result)
    if pricing:
        result = re.sub(r"^What's the rate\b", "What is the rate", result)
    if punctuation.endswith("?"):
        result = request_in_english.sub("Could you ", result)
    return result

def business_line(line, infer):
    # The local model can silently omit a second sentence after a greeting.
    start = 0
    pieces = []
    for gap in re.finditer(r"(?<=[.!?])\s+(?=\S)", line):
        if abbreviation.search(line[start:gap.start()]):
            continue
        pieces.extend([business_sentence(line[start:gap.start()], infer), gap[0]])
        start = gap.end()
    pieces.append(business_sentence(line[start:], infer))
    return "".join(pieces)


@lru_cache(maxsize=1)
def glossary_pattern(entries):
    # A saved phrase takes precedence over individual words within it.
    alternatives = [r"(?P<t%d>(?<!\w)%s(?!\w))" % (i, re.escape(term))
                    for i, (term, _) in enumerate(entries)]
    return re.compile("|".join(alternatives), re.IGNORECASE)


def apply_glossary(line, entries, infer):
    pattern = glossary_pattern(entries)
    hits = [hit for hit in pattern.finditer(line)
            if not value_term.fullmatch(hit[0]) or pricing_at(line, hit)]
    if not hits:
        return business_line(line, infer)

    def replacement(hit):
        return entries[int(hit.lastgroup[1:])][1]

    def substitute(replace):
        parts = []
        start = 0
        for hit in hits:
            parts.extend([line[start:hit.start()], replace(hit)])
            start = hit.end()
        return "".join([*parts, line[start:]])

    if not any(c.isalnum() for c in substitute(lambda _: "")):
        return substitute(replacement)

    # Keep the surrounding sentence intact so the model can reorder the terms.
    prefix = "ZXTERM"
    while prefix in line.upper():
        prefix += "X"
    markers = [prefix + str(i) + "Z" for i in range(len(hits))]
    tokens = iter(markers)
    masked = substitute(lambda _: next(tokens))
    # In a handoff message, "segue a tabela" means "here is the table".
    masked = re.sub(r"^segue ([oa]) (?=" + prefix + r"\d+Z)", r"Aqui está \1 ", masked, flags=re.I)
    masked = re.sub(r"^seguem ([oa]s) (?=" + prefix + r"\d+Z)", r"Aqui estão \1 ", masked, flags=re.I)
    result = business_line(masked, infer)
    marker_pattern = re.compile(re.escape(prefix) + r"\d+Z", re.I)
    found = [m.upper() for m in marker_pattern.findall(result)]
    if sorted(found) == sorted(markers):
        terms = dict(zip(markers, map(replacement, hits)))
        return marker_pattern.sub(lambda m: terms[m[0].upper()], result)

    # If a marker was lost or duplicated, translate the surrounding text separately.
    def fragment(text):
        return re.sub(r"\S(?:.*\S)?", lambda m: business_line(m[0], infer), text)
    parts = []
    start = 0
    for hit in hits:
        parts.extend([fragment(line[start:hit.start()]), replacement(hit)])
        start = hit.end()
    parts.append(fragment(line[start:]))
    return "".join(parts)


def translate(text, target, glossary=None):
    segments = link.split(text)
    prose = " ".join(segments[::2])
    if not any(c.isalpha() for c in prose):
        return {"text": text, "unchanged": True}
    if target == "pt":
        source = incoming_language(prose)
        if not source:
            return {"text": text, "unchanged": True}
    else:
        source = "pt"
    pair = f"{source}_{target}"
    if pair not in models:
        pointer = root / (pair + ".active")
        generation = pointer.read_text().strip() if pointer.exists() else pair
        if Path(generation).name != generation or not generation.startswith(pair):
            raise ValueError("Modelo inválido")
        folder = root / generation
        models[pair] = load_model(folder, pair)
    tokenizer, engine = models[pair]
    def infer(line):
        if not any(c.isalpha() for c in line):
            return line
        tokens = tokenizer.encode(line, out_type=str)
        pieces = []
        while tokens:
            cut = min(160, len(tokens))
            if cut < len(tokens):
                cut = next((i for i in range(cut, cut // 2, -1) if tokens[i].startswith("▁")), cut)
            result = engine.translate_batch([tokens[:cut]], beam_size=3, max_decoding_length=512)[0]
            part = tokenizer.decode(result.hypotheses[0]).replace('▁', ' ').strip()
            if not part:
                raise ValueError("Tradução vazia")
            pieces.append(part)
            tokens = tokens[cut:]
        return " ".join(pieces)

    entries = ()
    if pair == "pt_en":
        terms = dict(commercial_terms)
        for entry in glossary or ():
            terms[entry["source"].casefold()] = entry["target"]
        entries = tuple(sorted(terms.items(), key=lambda item: -len(item[0])))

    def translate_line(match):
        if entries:
            line = unicodedata.normalize("NFC", match[0])
            active_entries = entries
            if non_rate_context.search(line) and not any(term == "valores" for term, _ in entries):
                active_entries = tuple(sorted((*entries, ("valores", "rates")), key=lambda item: -len(item[0])))
            translated_line = apply_glossary(line, active_entries, infer)
            if any(line.casefold().startswith(term) and terms[term] == target
                   for term, target in commercial_terms.items()) and line[:1].isupper():
                return translated_line[:1].upper() + translated_line[1:]
            return translated_line
        return business_line(match[0], infer) if pair == "pt_en" else infer(match[0])

    # Keep link boundaries and original whitespace, including CRLF and blank lines.
    for i in range(0, len(segments), 2):
        segments[i] = re.sub(r"\S(?:[^\r\n]*\S)?", translate_line, segments[i])
    translated = "".join(segments)
    if target == "pt" and words(translated) == words(text):
        return {"text": text, "unchanged": True}
    return {"text": translated}


if sys.argv[1] == "--check-model":
    pair, folder = sys.argv[2:]
    tokenizer, engine = load_model(Path(folder), pair)
    if pair not in ("en_pt", "es_pt"):
        sample = tokenizer.encode("teste", out_type=str)
        if not engine.translate_batch([sample])[0].hypotheses[0]:
            raise ValueError("Tradução vazia")
    sys.exit(0)

root = Path(sys.argv[1])
detector = LanguageDetectorBuilder.from_languages(Language.PORTUGUESE, Language.ENGLISH, Language.SPANISH).build()
for line in sys.stdin:
    try:
        request = json.loads(line)
        if request["target"] not in ("pt", "en", "es") or not 0 < len(request["text"]) <= 6000:
            raise ValueError("Entrada inválida")
        reply = translate(request["text"], request["target"], request.get("glossary"))
    except Exception:
        reply = {"error": "Tradução local indisponível"}
    print(json.dumps(reply, ensure_ascii=True), flush=True)
