name: Bot Harga Emas safehaven.assets

on:
  schedule:
    - cron: "2,17,32,47 * * * *"   # dicek tiap 15 menit; update global tetap dikirim maks. 1x per jam
  push:
    paths: ["harga.json"]          # langsung kirim saat harga Antam diterbitkan dari aplikasi
  workflow_dispatch: {}            # tombol "Run workflow" untuk tes manual

concurrency:
  group: telegram-emas
  cancel-in-progress: false

permissions:
  contents: write   # menyimpan harga dari perintah /antam & catatan akurasi
  pages: write      # meminta GitHub Pages membangun ulang halaman publik

jobs:
  kirim:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Pasang pembuat gambar
        run: npm install --no-save --no-package-lock --no-audit --no-fund @napi-rs/canvas@1

      - name: Ambil status terakhir
        uses: actions/cache/restore@v4
        with:
          path: .tg-state
          key: tg-state-${{ github.run_id }}
          restore-keys: tg-state-

      - name: Kirim ke Telegram & WA
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
          TELEGRAM_CHAT: ${{ secrets.TELEGRAM_CHAT }}
          TELEGRAM_ADMIN: ${{ secrets.TELEGRAM_ADMIN }}
          WHAPI_TOKEN: ${{ secrets.WHAPI_TOKEN }}
          WA_CHANNEL: ${{ secrets.WA_CHANNEL }}
          TWELVEDATA_KEY: ${{ secrets.TWELVEDATA_KEY }}
          QUIET_HOURS: ${{ vars.QUIET_HOURS }}
          WA_INTERVAL_JAM: ${{ vars.WA_INTERVAL_JAM }}
          PAGE_URL: ${{ vars.PAGE_URL }}
        run: node scripts/telegram.mjs

      - name: Simpan status
        if: always()
        uses: actions/cache/save@v4
        with:
          path: .tg-state
          key: tg-state-${{ github.run_id }}

      - name: Simpan harga dari Telegram & catatan akurasi
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          berubah=""
          for f in harga.json akurasi.json; do
            if [ -f "$f" ] && [ -n "$(git status --porcelain -- "$f")" ]; then git add "$f"; berubah=1; fi
          done
          if [ -n "$berubah" ]; then
            git config user.name "bot-harga-emas"
            git config user.email "bot-harga-emas@users.noreply.github.com"
            git commit -m "Bot: harga/akurasi $(date -u +'%F %H:%M') UTC"
            git pull --rebase --autostash origin "${GITHUB_REF_NAME}"
            git push
            # commit dari GITHUB_TOKEN tidak memicu build Pages, jadi minta build secara eksplisit
            curl -s -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
              "https://api.github.com/repos/${GITHUB_REPOSITORY}/pages/builds" >/dev/null || true
          fi

      - name: Kabari admin jika bot gagal
        if: failure()
        env:
          TELEGRAM_TOKEN: ${{ secrets.TELEGRAM_TOKEN }}
          TELEGRAM_ADMIN: ${{ secrets.TELEGRAM_ADMIN }}
        run: |
          if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_ADMIN" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
              --data-urlencode "chat_id=${TELEGRAM_ADMIN}" \
              --data-urlencode "text=❌ Bot harga emas GAGAL berjalan. Lihat detail: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" >/dev/null
          fi
