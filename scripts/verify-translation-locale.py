"""Check the packaged WhatsApp translation worker against an isolated model update."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    installed = Path(sys.argv[1])
    worker_source = sys.stdin.buffer.read()
    with tempfile.TemporaryDirectory(prefix="bira-translation-check-") as temp:
        root = Path(temp)
        worker = root / "translate-worker.py"
        worker.write_bytes(worker_source)
        for pair in ("en_pt", "es_pt"):
            pointer = installed / (pair + ".active")
            name = pointer.read_text().strip() if pointer.exists() else pair
            if Path(name).name != name or not name.startswith(pair):
                raise ValueError("Ponteiro de modelo inválido")
            source = installed / name
            # Exercita o diretório legado e a geração ativada por uma atualização.
            target = root / ("en_pt-update" if pair == "en_pt" else pair)
            target.mkdir()
            shutil.copy2(source / "sentencepiece.model", target / "sentencepiece.model")
            shutil.copytree(source / "model", target / "model")
        (root / "en_pt.active").write_text("en_pt-update", encoding="utf8")
        model_dir = root / "en_pt-update/model"
        config_path = model_dir / "config.json"
        config = json.loads(config_path.read_text(encoding="utf8"))
        config.update(bos_token=">>por<<", add_source_bos=True)
        config_path.write_text(json.dumps(config), encoding="utf8")

        def translate(sentences):
            requests = "".join(json.dumps({"text": s, "target": "pt"}) + "\n" for s in sentences)
            result = subprocess.run([sys.executable, "-I", "-X", "utf8", str(worker), str(root)],
                                    input=requests, text=True, encoding="utf8", stdout=subprocess.PIPE,
                                    check=True, timeout=30)
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            assert len(replies) == len(sentences), "Resposta de tradução ausente"
            return replies

        questions = ["Where is the bus stop?", "¿Dónde está la parada de autobús?"]
        for sentence, reply in zip(questions, translate(questions)):
            assert "ônibus" in reply.get("text", "").casefold(), (sentence, reply)
        fixed = json.loads(config_path.read_text(encoding="utf8"))
        assert fixed["bos_token"] == ">>pob<<" and fixed["add_source_bos"] is True

        # Um token no config não basta se o vocabulário da nova versão o perdeu.
        vocab_path = model_dir / "shared_vocabulary.json"
        vocab = json.loads(vocab_path.read_text(encoding="utf8"))
        vocab[vocab.index(">>pob<<")] = "<unused-locale>"
        vocab_path.write_text(json.dumps(vocab), encoding="utf8")
        reply, = translate(questions[:1])
        assert reply.get("error") and "text" not in reply, "Modelo incompatível usado em português"
    print("WhatsApp pt-BR passou: modelo atualizado corrigido, inglês e espanhol verificados.")


if __name__ == "__main__":
    main()
