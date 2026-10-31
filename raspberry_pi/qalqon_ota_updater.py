#!/usr/bin/env python3
"""
🛡️ QALQON v1.0 — Raspberry Pi 4 Autonomous OTA Git Auto-Updater & Watchdog
=============================================================================
Bu xizmat fon rejimida (systemd orqali) uzluksiz ishlaydi:
1. GitHub repozitoriyasidagi (origin/main) yangi commit va o'zgarishlarni tekshiradi.
2. Yangilanish bo'lsa, xavfsizlik uchun robot harakatini to'xtatadi ('S').
3. Yangi kodlarni yuklab oladi (git pull --ff-only).
4. Yangi Python kutubxonalari bo'lsa (requirements.txt), ularni o'rnatadi.
5. Asosiy robot boshqaruv xizmatini qayta yuklaydi (systemctl restart qalqon-core).
6. 🛡️ ANTI-BRICK / ROLLBACK WATCHDOG: Yangi kod ishga tushgach, /api/health orqali
   tizim sog'lomligini tekshiradi. Agar yangi kod xato berib to'xtab qolsa,
   avtomatik ravishda oldingi barqaror versiyaga (git reset --hard) qaytaradi!
=============================================================================
"""

import os
import sys
import time
import json
import logging
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

# Asosiy yo'llar
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
LOG_DIR = Path("/var/log/qalqon")
if not LOG_DIR.exists():
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        LOG_DIR = SCRIPT_DIR / "logs"
        LOG_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = LOG_DIR / "ota_updater.log"
HISTORY_FILE = SCRIPT_DIR / "ota_history.json"
CONFIG_FILE = SCRIPT_DIR / "ota_config.json"

# Logging sozlash
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("QalqonOTA")

# Standart konfiguratsiya
DEFAULT_CONFIG = {
    "enabled": True,
    "branch": "main",
    "check_interval_sec": 30,
    "health_check_url": "http://localhost:8000/api/health",
    "health_timeout_sec": 25,
    "auto_rollback": True,
    "core_service_name": "qalqon-core.service"
}

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                return {**DEFAULT_CONFIG, **cfg}
        except Exception as e:
            logger.warning(f"Konfiguratsiya faylini o'qishda xatolik: {e}. Standart sozlamalar ishlatiladi.")
    return DEFAULT_CONFIG.copy()

def run_cmd(cmd, cwd=REPO_ROOT, timeout=120) -> tuple[int, str, str]:
    """Buyruqni xavfsiz ishga tushirish"""
    try:
        res = subprocess.run(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            shell=isinstance(cmd, str)
        )
        return res.returncode, res.stdout.strip(), res.stderr.strip()
    except Exception as e:
        return -1, "", str(e)

def get_current_commit() -> str:
    rc, out, _ = run_cmd(["git", "rev-parse", "HEAD"])
    return out if rc == 0 else ""

def get_remote_commit(branch: str = "main") -> str:
    rc, _, err = run_cmd(["git", "fetch", "origin", branch])
    if rc != 0:
        logger.debug(f"git fetch xatolik (ehtimol internet yo'q): {err}")
        return ""
    rc, out, _ = run_cmd(["git", "rev-parse", f"origin/{branch}"])
    return out if rc == 0 else ""

def get_commit_info(commit_hash: str) -> dict:
    rc, out, _ = run_cmd(["git", "log", "-1", "--format=%an|%ae|%s|%cd", commit_hash])
    if rc == 0 and out:
        parts = out.split("|")
        return {
            "author": parts[0] if len(parts) > 0 else "Noma'lum",
            "email": parts[1] if len(parts) > 1 else "",
            "message": parts[2] if len(parts) > 2 else "",
            "date": parts[3] if len(parts) > 3 else ""
        }
    return {}

def stop_robot_motion():
    """Yangilanish paytida robot to'satdan harakatlanmasligi uchun 'STOP' yuborish"""
    try:
        req = urllib.request.Request("http://localhost:8000/cmd?c=S", method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            pass
        logger.info("🛑 Robot harakati xavfsiz to'xtatildi (STOP).")
    except Exception:
        pass

def check_health(url: str, timeout_sec: int = 25) -> bool:
    """Tizim sog'lom ishlashini /api/health orqali tekshirish"""
    start_t = time.time()
    logger.info(f"🩺 Tizim tekshiruvi boshlandi: {url} (kutilmoqda: {timeout_sec}s)...")
    while time.time() - start_t < timeout_sec:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("status") == "healthy":
                        logger.info(f"✅ Tizim sog'lom ishga tushdi! (Uptime: {data.get('uptime_sec', 0)}s)")
                        return True
        except Exception:
            pass
        time.sleep(2)
    return False

def record_history(event_type: str, commit: str, info: dict, success: bool, note: str = ""):
    history = []
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []
    
    entry = {
        "timestamp": datetime.now().isoformat(),
        "event": event_type,
        "commit": commit,
        "author": info.get("author", ""),
        "message": info.get("message", ""),
        "success": success,
        "note": note
    }
    history.append(entry)
    # Faqat so'nggi 50 ta yozuvni saqlash
    history = history[-50:]
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Tarixni yozishda xatolik: {e}")

def restart_service(service_name: str) -> bool:
    logger.info(f"🔄 '{service_name}' xizmati qayta ishga tushirilmoqda...")
    rc, out, err = run_cmd(["sudo", "systemctl", "restart", service_name])
    if rc != 0:
        logger.error(f"Xizmatni qayta yuklashda xatolik: {err}")
        return False
    return True

def apply_update(prev_commit: str, target_commit: str, config: dict) -> bool:
    logger.info("=" * 60)
    logger.info(f"🚀 YANGI YANGILANISH ANIQLANDI!")
    logger.info(f"Oldingi versiya: {prev_commit[:8]} ➡️ Yangi versiya: {target_commit[:8]}")
    info = get_commit_info(target_commit)
    logger.info(f"Muallif: {info.get('author')} | Xabar: {info.get('message')}")
    logger.info("=" * 60)

    # 1. Robot harakatini to'xtatish
    stop_robot_motion()

    # 2. Yangi kodlarni tortib olish
    rc, out, err = run_cmd(["git", "pull", "--ff-only", "origin", config["branch"]])
    if rc != 0:
        logger.error(f"❌ git pull xatosi: {err}")
        record_history("PULL_FAILED", target_commit, info, False, err)
        return False

    # 3. O'zgargan fayllarni tahlil qilish
    rc, diff_files, _ = run_cmd(["git", "diff", "--name-only", prev_commit, target_commit])
    changed_files = diff_files.splitlines() if rc == 0 else []

    # 4. requirements.txt o'zgargan bo'lsa pip install
    req_file = "raspberry_pi/requirements.txt"
    if req_file in changed_files or "requirements.txt" in changed_files:
        logger.info("📦 'requirements.txt' o'zgargan. Yangi paketlar o'rnatilmoqda...")
        run_cmd(["pip3", "install", "--break-system-packages", "-r", str(SCRIPT_DIR / "requirements.txt")])

    # 5. Xizmatni qayta yuklash
    service_name = config["core_service_name"]
    restart_ok = restart_service(service_name)
    if not restart_ok:
        logger.error("Xizmatni restart qilib bo'lmadi.")

    # 6. Sog'lomlik tekshiruvi (Health Check & Rollback Watchdog)
    health_ok = check_health(config["health_check_url"], config["health_timeout_sec"])
    if health_ok:
        logger.info(f"🎉 YANGILANISH MUVAFFAQIYATLI YAKUNLANDI! ({target_commit[:8]})")
        record_history("UPDATE_SUCCESS", target_commit, info, True, "Tizim barqaror ishga tushdi.")
        return True
    else:
        logger.critical("⚠️ DIQQAT! YANGI KOD ISHLAMADI YOKI XATOLIK BERDI!")
        if config["auto_rollback"]:
            logger.warning(f"🛡️ AVTOMATIK ROLLBACK BOSHLANMOQDA: Oldingi commitga ({prev_commit[:8]}) qaytilmoqda...")
            run_cmd(["git", "reset", "--hard", prev_commit])
            restart_service(service_name)
            check_health(config["health_check_url"], 15)
            record_history("ROLLBACK", prev_commit, info, False, "Yangi kod nosozligi sababli oldingi versiyaga qaytarildi.")
            logger.info("🛡️ Tizim oldingi barqaror holatga muvaffaqiyatli qaytarildi.")
        return False

def main():
    logger.info("==========================================================")
    logger.info("🛡️ QALQON v1.0 — OTA AUTO-UPDATER & WATCHDOG ISHGA TUSHDI")
    logger.info(f"📂 Repozitoriya: {REPO_ROOT}")
    logger.info("==========================================================")

    config = load_config()
    current_commit = get_current_commit()
    logger.info(f"Hozirgi commit: {current_commit[:8] if current_commit else 'Noma`lum'}")

    while True:
        try:
            config = load_config()
            if not config.get("enabled", True):
                time.sleep(10)
                continue

            current_commit = get_current_commit()
            remote_commit = get_remote_commit(config.get("branch", "main"))

            if remote_commit and current_commit and remote_commit != current_commit:
                logger.info(f"Yangi o'zgarish bor! Lokal: {current_commit[:8]}, Masofaviy: {remote_commit[:8]}")
                success = apply_update(current_commit, remote_commit, config)
                if success:
                    current_commit = get_current_commit()

            time.sleep(config.get("check_interval_sec", 30))

        except KeyboardInterrupt:
            logger.info("OTA Auto-updater foydalanuvchi tomonidan to'xtatildi.")
            break
        except Exception as e:
            logger.error(f"Kutilmagan xatolik yuz berdi: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
