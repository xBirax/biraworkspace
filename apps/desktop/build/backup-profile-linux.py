"""Offline profile backup for BiraWorkspace on Ubuntu. Invoked by the main process."""
import argparse
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import uuid


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as tmp:
        json.dump(value, tmp, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)
    sync_dir(path.parent)


def snapshot(source, target=None, live=False):
    files = {}
    dirs = []
    size = 0
    def check_tree(directory):
        nonlocal size
        for entry in directory.iterdir():
            relative = entry.relative_to(source)
            if live and (entry.name in {"GPUCache", "Code Cache", "Cache", "DawnGraphiteCache",
                                        "DawnWebGPUCache", "Crashpad"} or
                         (directory == source and entry.name in {"SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"})):
                continue
            mode = entry.lstat().st_mode
            if stat.S_ISDIR(mode):
                dirs.append(relative.as_posix())
                if target:
                    (target / relative).mkdir(mode=0o700)
                check_tree(entry)
                if target:
                    sync_dir(target / relative)
            elif stat.S_ISREG(mode):
                with entry.open("rb") as stream:
                    if target:
                        with (target / relative).open("xb") as output:
                            shutil.copyfileobj(stream, output)
                            output.flush()
                            os.fsync(output.fileno())
                copy = target / relative if target else entry
                with copy.open("rb") as stream:
                    files[relative.as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
                size += copy.stat().st_size
            else:
                raise ValueError("O perfil contém um vínculo ou arquivo especial fora dos caches.")
    if source.is_symlink() or not source.is_dir():
        raise ValueError("Diretório de perfil inválido.")
    if target:
        target.mkdir(mode=0o700)
    check_tree(source)
    if target:
        sync_dir(target)
    return {"files": files, "dirs": sorted(dirs), "size": size}


def backup(profile, root):
    with tempfile.TemporaryDirectory(dir=root, prefix=".backup-") as stage:
        stage = Path(stage)
        manifest = snapshot(profile, stage / "profile", live=True)
        if not manifest["files"] or manifest != snapshot(profile, live=True):
            raise ValueError("O perfil está vazio ou mudou durante a cópia.")
        save_json(stage / "backup-info.json", {"schema": 1, "profile": str(profile), "manifest": manifest})
        name = "manual-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        stage.rename(root / name)
        sync_dir(root)
    return {"sizeBytes": manifest["size"], "target": str(root / name)}


def restore(profile, root, name):
    if not re.fullmatch(r"manual-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}", name):
        raise ValueError("Selecione uma cópia Linux válida.")
    source = root / name
    info_file = source / "backup-info.json"
    if source.is_symlink() or info_file.is_symlink():
        raise ValueError("Diretório de backup inválido.")
    info = json.loads(info_file.read_text())
    if info.get("schema") != 1 or info.get("profile") != str(profile):
        raise ValueError("O backup pertence a outro perfil.")
    # Ambos os diretórios ficam no mesmo volume. RENAME_EXCHANGE preserva um
    # perfil completo no caminho ativo mesmo se o computador desligar na troca.
    kept = Path(tempfile.mkdtemp(prefix=profile.name + ".anterior-", dir=profile.parent))
    staged = kept / "profile"
    exchanged = False
    try:
        if snapshot(source / "profile", staged) != info["manifest"] or not info["manifest"]["files"]:
            raise ValueError("Falha de integridade no backup.")
        if ctypes.CDLL(None, use_errno=True).renameat2(-100, os.fsencode(staged), -100, os.fsencode(profile), 2):
            raise OSError(ctypes.get_errno(), "Falha na troca atômica do perfil")
        exchanged = True
        sync_dir(kept)
        sync_dir(profile.parent)
    finally:
        if not exchanged:
            shutil.rmtree(kept)
    return {"target": str(staged)}


def main():
    parser = argparse.ArgumentParser()
    for arg in ["profile", "root", "ready", "relaunch"]:
        parser.add_argument("--" + arg, required=True)
    parser.add_argument("--restore")
    args = parser.parse_args()
    os.umask(0o077)
    profile = Path(args.profile)
    root = Path(args.root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    status = root / "backup-status.json"
    operation = "restore" if args.restore else "manual"
    with (root / ".operation.lock").open("a") as op:
        fcntl.flock(op, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with Path(str(profile) + ".backup.lock").open("a") as gate:
            save_json(status, {"state": "running", "label": operation, "startedAt": now()})
            Path(args.ready).touch(exist_ok=False)
            fcntl.flock(gate, fcntl.LOCK_EX)
            try:
                result = restore(profile, root, args.restore) if args.restore else backup(profile, root)
                save_json(status, {"state": "done", "finishedAt": now(), "label": operation, **result})
            except Exception as error:
                save_json(status, {"state": "failed", "finishedAt": now(), "label": operation, "message": str(error)})


    if args.relaunch:
        env = os.environ.copy()
        env.pop("CHROME_DESKTOP", None)
        env.pop("CHROME_CRASHPAD_PIPE_NAME", None)
        # Mantenha um pai para o novo processo Chromium. Todos os locks acima
        # já estão liberados, inclusive enquanto uma nova cópia é solicitada.
        subprocess.run([args.relaunch], env=env, start_new_session=True, check=False)


if __name__ == "__main__":
    main()
