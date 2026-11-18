# Datamine V2 Desktop

Základ desktopového Datamine pro Windows x64 a macOS na Apple Silicon. Rustový obal vychází z oficiální šablony [create-tauri-app 4.7.5](https://github.com/tauri-apps/create-tauri-app) pro React a TypeScript. Tauri balí přímo produkční sestavení editoru V2 z `apps/web`. Editor, kontrakty a renderer pocházejí z Projekt-PD, revize `923d49f`.

## Spuštění

Potřebujete Node.js 22, npm, Python 3.11 a systémové [závislosti Tauri](https://v2.tauri.app/start/prerequisites/). Verzi Rustu určuje `rust-toolchain.toml`. Příkazy Pythonu spouštějte v aktivním virtuálním prostředí s Pythonem 3.11.

```sh
npm ci
python -m pip install --require-hashes -r worker/requirements.lock
python scripts/build_stakeout_worker.py
npm run tauri:dev
```

V režimu ladění se při startu otevře inspektor. Pro samotný web použijte `npm run v2:dev`. V aplikaci vyberte **Pozemní stavba** nebo **Inženýrská stavba** a klikněte na **Otevřít syntetickou ukázku**. Předvyplněná 2D a 3D geometrie se počítá a vykresluje lokálně. Vlastní místní projekty používají úložiště webview. V inženýrském projektu funguje prohlížečový import bodů z CSV.

## Offline vytěžení vytyčovacích bodů

V desktopu založte inženýrský projekt a v sekci **Soubory** přidejte [syntetický výkres](fixtures/stakeout/synthetic.pdf). Zvolte **Vytěžit**, zkontrolujte pořadí os a CRS a potvrďte návrh. V 3D modelu použijte **Export → CSV body**. Souřadnice se nepřevádějí. Export používá stávající sloupce X, Y, Z pro E, N, Z.

Přibalený Python worker čte textové tabulky s jednoznačnou hlavičkou `BOD E N Z`. Podporuje tečku i čárku a maximálně 1000 bodů ve 20 stránkách a PDF do 2 MiB. Naskenované tabulky, PDF s formuláři, odkazy nebo šifrováním vyžadují jiný postup. Pro uživatele instalátoru je Python součástí balíku.

Editor předává obsah PDF přímo přes Tauri IPC. Samostatný proces přijímá PDF na standardním vstupu a má časový limit. Nepřijímá cesty ani volitelné příkazy, neposílá projektová data do sítě a neotevírá PDF odkazy. Jde o omezení rozhraní a zátěže procesu. Izolaci parseru na úrovni operačního systému tato verze neposkytuje.

## Ověření a build

```sh
python -m unittest discover -s worker
npm run v2:test
npm run tauri:build
```

GitHub Actions sestaví NSIS pro Windows x64 a DMG pro macOS arm64. V samostatném testovacím binárním souboru potom projde skutečným editorem V2 od přidání PDF přes opakovaný import až po porovnání exportu s [očekávaným CSV](fixtures/stakeout/expected.csv). Test kontroluje bajty předané ke stažení a potvrzené body po navigaci. Nepodepsané instalátory najdete v artefaktech úspěšného běhu. Produkční podpis a notarizace mají vlastní distribuční krok.

Testovací JSON, geometrie a rastrové podklady v tomto repozitáři jsou syntetické. Ukázkové otisky souborů v kontraktových testech jsou zástupné hodnoty. Zdroj ikony je v `branding/datamine.png`.
