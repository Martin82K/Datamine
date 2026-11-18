# Datamine Design

Přenosný design systém pro produktové, technické a datové aplikace Datamine. Balíček zachycuje vizuální jazyk „Atelier“ ze současné aplikace: tmavé technické plátno, indigové akce, významové stavové barvy, jemné skleněné vrstvy a krátký pružný pohyb.

Balíček nemá runtime závislosti, nestahuje fonty ani ikony a lze jej použít ve statickém HTML, Reactu, Vue, Svelte i desktopovém webview.

## Rychlé použití

```html
<html class="dm-theme" data-datamine-theme="dark">
  <head>
    <link rel="stylesheet" href="./node_modules/@datamine/design/styles.css">
  </head>
  <body>
    <button class="dm-btn dm-btn--primary">Otevřít výkres</button>
  </body>
</html>
```

Nebo v bundleru:

```js
import "@datamine/design/styles.css";
import { initDatamineTheme, setDatamineTheme } from "@datamine/design";

initDatamineTheme();
setDatamineTheme("dark"); // dark | light | system
```

Kořen aplikace musí mít `.dm-theme` a atribut `data-datamine-theme` na stejném elementu. CSS je záměrně namespacované prefixem `dm-`, aby nekolidovalo s hostitelskou aplikací.

## Vrstvy balíčku

- `styles/tokens.css` — barvy, typografie, spacing, radiusy, stíny, z-index a motion.
- `styles/base.css` — bezpečný namespacovaný základ a layout utility.
- `styles/components.css` — přenositelné komponenty a všechny interakční stavy.
- `styles/motion.css` — vstupy, popovery, toast, spinner, skeleton a reduced-motion.
- `design-map.json` — strojově čitelná mapa pro jiné projekty a generátory.
- `src/index.js` — malý validovaný správce dark/light/system tématu.

## Pravidla designu

1. Primární indigovou používejte pro jednu hlavní akci nebo aktivní výběr, ne jako dekoraci.
2. Oranžová, zelená, červená a cyan vždy nesou stavový význam.
3. Skleněný povrch patří na plovoucí nebo interaktivní vrstvy. Běžný obsah používá plochý panel.
4. Hover posouvá prvek maximálně o 1–2 px. Aktivní stav se vrací a jemně zmenší na `0.99`.
5. Focus ring musí zůstat viditelný. Stav nelze sdělovat jen barvou.
6. Technické hodnoty a souřadnice používejte přes `.dm-mono`.
7. SVG ikony mají `24 × 24` viewBox, 18px optickou velikost, stroke 1.75 a `currentColor`.

Brandová indigo `#607afb` je zdrojem akcentu. Primární tlačítko používá opticky příbuznou `#5369dc`, aby bílý text dosáhl kontrastu 4,75:1 (WCAG AA).

## Komponenty

```html
<section class="dm-card dm-card--glass dm-enter">
  <span class="dm-badge dm-badge--success">Zpracováno</span>
  <h2>Výkaz místností</h2>
  <div class="dm-field">
    <label class="dm-field__label" for="name">Název</label>
    <input class="dm-input" id="name" placeholder="Nový výkaz">
    <span class="dm-field__hint">Technický název bez citlivých údajů.</span>
  </div>
  <button class="dm-btn dm-btn--primary">Vytvořit</button>
</section>
```

Interaktivní přepínače musí používat `aria-pressed`, segmented control `aria-selected`, dialog správné `role="dialog"` a toast podle důležitosti `role="status"` nebo `role="alert"`.

## Témata a motion

`system` sleduje `prefers-color-scheme`. Volba se ukládá pouze lokálně a je validována allowlistem. Pokud je úložiště v sandboxu nedostupné, vykreslení pokračuje bez chyby.

Motion automaticky respektuje `prefers-reduced-motion`. Aplikace může animace vypnout i explicitně:

```html
<main class="dm-theme" data-datamine-theme="dark" data-datamine-motion="off"></main>
```

## Fonty a ikony

Roboto a Instrument Serif jsou pouze preferované rodiny. Balíček je sám nestahuje. Hostitelský projekt je může dodat lokálně přes `@font-face`; jinak se bezpečně použijí systémové fallbacky. Totéž platí pro ikony: doporučené jsou lokální inline SVG, nikoli externí icon font.

## Publikace a ověření

```bash
cd packages/datamine-design
npm run pack:check
```

Balíček je připravený k lokálnímu workspace použití i k publikaci do soukromého npm registru. Před veřejným publikováním doplňte vlastní licenci a upravte scope podle cílového registru.
