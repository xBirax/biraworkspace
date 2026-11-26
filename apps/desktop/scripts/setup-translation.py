"""Install the BiraWorkspace offline Portuguese, English and Spanish translator."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import venv
import zipfile
import tempfile

root = Path((os.getenv("LOCALAPPDATA") if os.name == "nt" else os.getenv("XDG_DATA_HOME")) or Path.home() / ".local/share") / "BiraWorkspace/translation"
root.mkdir(parents=True, exist_ok=True)
python = root / ("venv/Scripts/python.exe" if os.name == "nt" else "venv/bin/python")
if not python.exists():
    venv.create(root / "venv", with_pip=True)
subprocess.check_call([str(python), "-m", "pip", "install", "--disable-pip-version-check",
                       "msvc-runtime==14.51.36231; sys_platform == 'win32'", "ctranslate2==4.9.0", "sentencepiece==0.2.3", "lingua-language-detector==2.2.0"])
models = {
    "en_pt-1_9": "0c5350a2fa5b923de1346edc0d42e08e38bab2e33cede3a0b9a48eb4281ad8a9",
    "es_pt-1_0": "c772951dee3917f799b701bde0612331f54e1aa09d709dd057bee6b41bb04936",
    "pt_en-1_9": "ae76df6f650895c16f2b582065014fab496755ca846ecb19fae81d51f332a38e",
    "pt_es-1_0": "72bdf5ef169f4321a810a03fe8639b207c925434d2abc90dfa6adc9a42197180",
}

def valid(directory, pair):
    if not (directory / "model/model.bin").is_file():
        return False
    worker = Path(__file__).with_name("translate-worker.py")
    if not worker.is_file():
        worker = Path(__file__).resolve().parents[1] / "src/main/translate-worker.py"
    command = [str(python), "-I", "-X", "utf8", str(worker), "--check-model", pair, str(directory)]
    return subprocess.run(command, check=False).returncode == 0


for name, digest in models.items():
    pair = name.split("-")[0]
    pointer = root / (pair + ".active")
    current = pointer.read_text().strip() if pointer.exists() else pair
    if Path(current).name == current and (current == pair or current.startswith(name + "-" + digest[:12])) and valid(root / current, pair):
        continue
    with tempfile.TemporaryDirectory(prefix=".stage-", dir=root) as temporary:
        stage = Path(temporary)
        archive = stage / "package.zip"
        url = "https://argos-net.com/v1/translate-" + name + ".argosmodel"
        if os.name == "posix":
            subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--output", str(archive), url], check=True)
        else:
            urllib.request.urlretrieve(url, archive)
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                raise ValueError("Pacote inválido: " + name)
        directory = stage / "unpacked"
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if item.is_dir():
                    continue
                relative = Path(*item.filename.split("/")[1:])
                out = (directory / relative).resolve()
                if not out.is_relative_to(directory.resolve()):
                    raise ValueError("Caminho inválido")
                out.parent.mkdir(parents=True, exist_ok=True)
                with package.open(item) as inp, out.open("wb") as dest:
                    shutil.copyfileobj(inp, dest)
        if not valid(directory, pair):
            raise ValueError("Falha ao carregar o modelo " + pair)
        # A troca do ponteiro publica um diretório completo. Leitores em curso
        # podem continuar usando a geração anterior.
        generation = name + "-" + digest[:12]
        if not (root / generation).exists():
            directory.rename(root / generation)
        elif not valid(root / generation, pair):
            generation += "-" + stage.name
            directory.rename(root / generation)
        marker = stage / "active"
        marker.write_text(generation,encoding="utf8")
        os.replace(marker,pointer)
print("Tradução local instalada.")
