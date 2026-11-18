# Datamine V2 Desktop

Základ desktopového Datamine pro Windows x64 a macOS na Apple Silicon. Rustový obal vychází z oficiální šablony [create-tauri-app 4.7.5](https://github.com/tauri-apps/create-tauri-app) pro React a TypeScript. Tauri balí přímo produkční sestavení editoru V2 z `apps/web`. Editor, kontrakty a renderer pocházejí z Projekt-PD, revize `923d49f`.

## Spuštění

Potřebujete Node.js 22, npm a systémové [závislosti Tauri](https://v2.tauri.app/start/prerequisites/). Verzi Rustu určuje `rust-toolchain.toml`.

```sh
npm ci
npm run tauri:dev
```

V režimu ladění se při startu otevře inspektor. Pro samotný web použijte `npm run v2:dev`. V aplikaci vyberte **Pozemní stavba** nebo **Inženýrská stavba** a klikněte na **Otevřít syntetickou ukázku**. Předvyplněná 2D a 3D geometrie se počítá a vykresluje lokálně. Vlastní místní projekty používají úložiště webview. V inženýrském projektu funguje prohlížečový import bodů z CSV.

Tato verze obsahuje editor a místní práci s modely. Napojení přibaleného Python workeru pro automatické vytěžení PDF patří do navazující etapy. Výchozí sestavení používá lokální katalog a vynechává vzdálené služby.

## Ověření a build

```sh
npm run v2:test
npm run tauri:build
```

GitHub Actions sestaví NSIS pro Windows x64 a DMG pro macOS arm64. Po testech uloží nepodepsané instalátory jako artefakty běhu. Produkční podpis a notarizace mají vlastní distribuční krok.

Testovací JSON, geometrie a rastrové podklady v tomto repozitáři jsou syntetické. Ukázkové otisky souborů v kontraktových testech jsou zástupné hodnoty. Zdroj ikony je v `branding/datamine.png`.
