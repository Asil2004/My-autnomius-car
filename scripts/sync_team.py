#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
QALQON v1.0 — Jamoa Ishlarini Avtomatik Sinxronizatsiya Qilish Skripti
Muallif: Asilbek (Bosh mexatronik)

Vazifasi:
1. GitHub origin'dan barcha yangi branch va kommitlarni tortib oladi (fetch).
2. 'main' tarmog'ini avtomatik yangilaydi (pull).
3. Jamoa a'zolari (Sarvar, Boburjon, Odilov va h.k.) ochgan yangi branchlarni ko'rsatadi.
4. Frontend ishlab chiqarish to'plamini (Vite) qayta yig'adi (npm run build).
5. 'main' va 'gh-pages' tarmoqlarini GitHub Pages bilan to'liq sinxronlashtiradi.
=============================================================================
"""

import os
import sys
import subprocess

def run_cmd(cmd, cwd=None, exit_on_error=True):
    print(f"\n[EXEC] {cmd} ...")
    res = subprocess.run(cmd, shell=True, cwd=cwd)
    if res.returncode != 0 and exit_on_error:
        print(f"[XATO] Buyruq xatolik bilan tugadi (kod: {res.returncode}): {cmd}")
        sys.exit(res.returncode)
    return res.returncode

def main():
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(repo_root)

    print("=" * 70)
    print("   🤖 QALQON v1.0: JAMOA ISHLARINI AVTOMATIK SINXRONLASHTIRISH")
    print("=" * 70)

    # 1. Fetch
    print("\n1. GitHub'dan barcha yangiliklar tekshirilmoqda...")
    run_cmd("git fetch --all --prune")

    # 2. Main pull
    print("\n2. 'main' tarmog'i so'nggi holatga keltirilmoqda...")
    run_cmd("git pull origin main")

    # 3. Branchlarni ko'rsatish
    print("\n3. Mavjud masofaviy (remote) tarmoqlar:")
    subprocess.run("git branch -r", shell=True)

    # 4. Frontend build
    frontend_dir = os.path.join(repo_root, "frontend")
    if os.path.exists(frontend_dir):
        print("\n4. Frontend yig'ilmoqda (npm run build)...")
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        run_cmd(f"{npm_cmd} run build", cwd=frontend_dir)

        print("\n5. Ildiz katalogiga va assetlarga nusxalanmoqda...")
        if sys.platform == "win32":
            subprocess.run(f"powershell -Command \"Copy-Item -Path '{frontend_dir}\\dist\\*' -Destination '{repo_root}' -Recurse -Force\"", shell=True)
        else:
            subprocess.run(f"cp -rf {frontend_dir}/dist/* {repo_root}/", shell=True)

    # 6. Status va push
    print("\n6. 'gh-pages' bilan sinxronlashtirilmoqda...")
    run_cmd("git push origin main:gh-pages --force", exit_on_error=False)

    print("\n" + "=" * 70)
    print("   ✅ HAMMA ISHLAR MUVAFFAQIYATLI SINXRONLASHTIRILDI!")
    print("   🌐 Jonli sayt: https://asil2004.github.io/My-autnomius-car/")
    print("=" * 70)

if __name__ == '__main__':
    main()
