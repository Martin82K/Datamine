# Migrační mapa

Nové projekty používají prefix `dm-`. Stávající aplikaci není nutné převést najednou; balíček lze zavádět po komponentách.

| Současný vzor | Datamine komponenta | Poznámka |
|---|---|---|
| `.pd-btn`, `.ed-btn` | `.dm-btn` | Varianty `--primary`, `--secondary`, `--quiet`, `--danger`, `--sm`, `--icon` |
| `.pd-iconbtn` | `.dm-btn.dm-btn--icon` | Aktivní stav přes `aria-pressed="true"` |
| `.pd-chip`, `.ed-chip`, `.ed-tag` | `.dm-chip`, `.dm-badge` | Barvu vybírat podle významu |
| `.pd-proj`, `.pd-recent` | `.dm-card.dm-card--glass.dm-card--interactive` | Zachovává sklo, horní akcent a hover lift |
| `.ed-panel` | `.dm-panel` | Header/body/footer jsou samostatné prvky |
| `.pd-input`, `.ed-field` | `.dm-input`, `.dm-select`, `.dm-textarea` | Chyba přes `aria-invalid="true"` |
| `.pd-seg`, `.ed-seg` | `.dm-segmented` | Výběr přes `aria-selected="true"` |
| `.pd-fade` | `.dm-enter` | Respektuje reduced motion |
| `.spin` | `.dm-spinner` | Přidejte skrytý text se stavem načítání |

## Doporučený postup

1. Na kořen obrazovky přidejte `.dm-theme` a `data-datamine-theme`.
2. Importujte celý `styles.css`; při postupné migraci lze importovat vrstvy samostatně.
3. Nahraďte nejdříve tokeny a atomické prvky, potom karty, panely a toolbar.
4. Odstraňte externí Material Symbols tam, kde je lze nahradit lokálním SVG.
5. V každém kroku otestujte dark/light, klávesnici, 320px viewport a reduced motion.
