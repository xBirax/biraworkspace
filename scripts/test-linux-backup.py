"""Exercise the installed helper on disposable data with the Linux profile lock."""
import fcntl
import json
import errno
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


HELPER = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "apps/desktop/build/backup-profile-linux.py"


class ProfileBackup(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.profile = base / "BiraWorkspace"
        self.root = base / "Backups"
        self.ready = base / "ready"
        self.gate = Path(str(self.profile) + ".backup.lock").open("a")
        self.addCleanup(self.gate.close)
        for service in ("one", "two"):
            partition = self.profile / "Partitions" / service
            partition.mkdir(parents=True)
            (partition / "cookie-fixture").write_text(service)
        self.state = self.profile / "state"
        self.state.write_text("antes")
        cache = self.profile / "Cache"
        cache.mkdir()
        (cache / "unused").touch()

    def launch(self, *args):
        return subprocess.Popen([sys.executable, "-I", HELPER, "--profile", self.profile,
                                 "--root", self.root, "--ready", self.ready, "--relaunch", "", *args])

    def status(self):
        return json.loads((self.root / "backup-status.json").read_text())

    def make_backup(self):
        fcntl.flock(self.gate, fcntl.LOCK_SH)
        process = self.launch()
        try:
            for _ in range(100):
                if self.ready.exists():
                    break
                time.sleep(.05)
            self.assertTrue(self.ready.exists())
            self.assertEqual(self.status()["state"], "running")
            self.assertEqual(list(self.root.glob("manual-*")), [])
            self.ready.unlink()
        finally:
            fcntl.flock(self.gate, fcntl.LOCK_UN)
            process.wait(timeout=10)
        self.assertEqual(self.status()["state"], "done")
        return Path(self.status()["target"])

    def test_round_trip_and_previous_profile(self):
        backup = self.make_backup()
        self.assertFalse((backup / "profile/Cache").exists())
        self.state.write_text("depois")
        self.launch("--restore", backup.name).wait(timeout=10)
        self.assertEqual(self.status()["state"], "done")
        self.assertEqual(self.state.read_text(), "antes")
        self.assertEqual((Path(self.status()["target"]) / "state").read_text(), "depois")
        for service in ("one", "two"):
            self.assertEqual((self.profile / "Partitions" / service / "cookie-fixture").read_text(), service)

    def test_damaged_copy_preserves_current_profile(self):
        backup = self.make_backup()
        (backup / "profile/state").write_text("danificado")
        self.launch("--restore", backup.name).wait(timeout=10)
        self.assertEqual(self.status()["state"], "failed")
        self.assertEqual(self.state.read_text(), "antes")

    def test_no_space_during_staging(self):
        self.root.mkdir()
        spec = importlib.util.spec_from_file_location("bira_backup", HELPER)
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        with patch.object(engine.shutil, "copyfileobj", side_effect=OSError(errno.ENOSPC, "disco cheio")):
            with self.assertRaises(OSError):
                engine.backup(self.profile, self.root)
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual(self.state.read_text(), "antes")

    def test_interruption_while_app_is_open(self):
        fcntl.flock(self.gate, fcntl.LOCK_SH)
        worker = self.launch()
        try:
            for _ in range(100):
                if self.ready.exists():
                    break
                time.sleep(.05)
            self.assertTrue(self.ready.exists())
            worker.kill()
            worker.wait(timeout=10)
        finally:
            fcntl.flock(self.gate, fcntl.LOCK_UN)
        self.ready.unlink()
        self.assertEqual(self.state.read_text(), "antes")
        self.assertEqual(list(self.root.glob("manual-*")), [])
        self.assertTrue(self.make_backup().is_dir())

    def test_special_file_is_not_published(self):
        (self.profile / "link").symlink_to(self.state)
        self.launch().wait(timeout=10)
        self.assertEqual(self.status()["state"], "failed")
        self.assertEqual(list(self.root.glob("manual-*")), [])


if __name__ == "__main__":
    unittest.main()

