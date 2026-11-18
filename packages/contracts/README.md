# @datamine/contracts

Jediný typovaný zdroj přenosových kontraktů Datamine V2. TypeBox schémata poskytují TypeScript typy a deterministicky se exportují jako JSON Schema Draft 7 do kořenového `schemas/v1/`.

Balíček nesmí importovat React, Three.js, FastAPI, databázi ani filesystem doménových dat. Filesystem používá pouze buildový exportér na pevnou cestu v repozitáři.

## Audit event v1

`datamine.audit-event.v1` je společný Python/TypeScript kontrakt pro
bezpečnostně významné události API a workeru. Přijímá pouze bounded technické
reference, serverový UTC čas, intent/outcome fázi a povinný `redacted: true`
marker. `additionalProperties: false` záměrně odmítá tokeny, e-mail, raw
payload, geometrii a jiné klientem přidané údaje. Platná fixture je
`fixtures/contracts/v1/valid-audit-event.json`.

## Rooms v1

`datamine.room-object.v1` je diskriminovaná rooms varianta společného modelu.
Polygon vždy nese souřadný prostor; vlastnosti používají explicitní jednotky
`_m`/`_m2` a oddělují strojovou `quality`, lidský `review_state` a
`confidence`. Provenience obsahuje ID i SHA-256 zdrojového dokumentu.

JSON Schema hlídá tvar a limity. `isContract` navíc lineárně odmítá ring s méně
než třemi různými body nebo nulovou plochou; Python adaptér provádí stejnou
sémantickou kontrolu nad stejnými fixtures.

## Document view v1

`datamine.document-view.v1` je explicitní kalibrace jedné stránky dokumentu
pro renderer. `page_width_pt` a `page_height_pt` jsou rozměry zobrazené PDF
stránky v bodech po zohlednění `page_rotation_deg`; `drawing_scale` je měřítko
výkresu a `pdf_to_drawing_m` je afinní matice `[a,b,c,d,e,f]` ve směru

```text
x_m = a*x_pt + c*y_pt + e
y_m = b*x_pt + d*y_pt + f
```

Kontrakt vyžaduje vazbu na konkrétní `source_document_id` a SHA-256, povoluje
jen PDF display-space jako zdroj a `drawing_m` jako cíl a odmítá singulární
nebo nečíselnou transformaci. `document_view` je volitelné aditivní pole v
`datamine.model-version.v1`, aby starší immutable modely zůstaly čitelné.

Fixture parity mezi TypeScriptem a Pythonem pokrývá platnou kalibraci, singularní
matici, neplatnou rotaci a neznámá pole. Změna schématu se vždy regeneruje
příkazem `npm run v2:schemas`.

## Model version commands v1

`datamine.model-version-command-batch.v1` je veřejná obálka pro optimistic
concurrency nad immutable modelovou verzí. Váže project, base version, revizi a
SHA-256 obsahu a povoluje pouze typované rooms commandy: upsert existujícího
objektu, remove a omezený properties patch. Selection ani filesystemová cesta
nejsou součástí perzistentního kontraktu.

## LandXML TIN v1

`datamine.landxml-tin.v1` přijímá pouze zvolený namespace LandXML 1.2 a váže
zdrojový document ID i SHA-256 na `datamine.tin-surface-object.v1`. TIN je v
prvním řezu indexovaný a vložený přímo do modelu: nejvýše 20 000 unikátních
bodů a 40 000 proti směru hodinových ručiček orientovaných trojúhelníků.
Souřadnice jsou výhradně `survey_crs`; povinné metadata určují EPSG,
`east_north_up`, metry a pojmenované vertikální datum.

TypeScript i Python navíc ke schématu kontrolují indexy, duplicity bodů,
degeneraci/orientaci faces, přesné bounds a shodu provenience. Větší TIN se do
tohoto payloadu nevejde; content-addressed přenos řeší samostatný chunk kontrakt.

## CAD underlay view v1

`datamine.cad-underlay-view.v1` podporuje pasivní `cad_pdf` podklad. Obsahuje
document ID/SHA/ETag, page metadata, explicitní EPSG/Bpv a invertibilní
`pdf_to_survey_xy` + `survey_to_world_xy`. Nejméně tři kontrolní body musejí
splnit uloženou toleranci. View je volitelné pole model version, není
`DatamineObject` a nikdy se nepoužívá jako autoritativní geometrie.

## Civil axis/profile/sweep v1

`civil.axis` ukládá 3D polyline v explicitním `survey_crs`; jeho stationing je
vodorovná kumulativní délka XY v metrech od `start_station_m`. `civil.profile`
odkazuje na osu a nese striktně rostoucí vzorky station/elevation bez
extrapolace. Každý profilový bod leží XY na odkazované ose a jeho Z odpovídá
elevaci vzorku.

`datamine.civil-tools.v1` popisuje vstup sweepu: přesná ID osy a profilu,
sekci se striktně rostoucími offsety, sampling a explicitní caps. Výsledný
`civil.sweep` je omezený indexed mesh se stabilními bounds a jako derived
objekt smí vzniknout pouze ve stavu `unreviewed`. TypeScript i Python ověřují
vazby, CRS, station range, degenerované faces a skutečné bounds.

## Stakeout point/group v1

Kontraktový základ V2-4-05 tvoří `datamine.stakeout-point.v1` a
`datamine.stakeout-group.v1`. Bod používá `point3d` výhradně v explicitním
`survey_crs` (`east_north_up`, metry, EPSG a vertical datum), dále nese
bezpečný textový `name`, technický `code`, `coordinate_tolerance_m`,
`accuracy`, `review_state` a `ObjectProvenance` se source ID/SHA. `code` je
stabilní ASCII identifikátor povolený pouze ve tvaru
`[A-Za-z0-9][A-Za-z0-9._-]*`.

`derivation.kind` rozlišuje `manual`, `axis_station_offset`,
`profile_station_offset` a `sweep_vertex`. U odvozených bodů validátor ověřuje
confirmed/corrected civil source, shodné CRS, rozsah staničení nebo index
vrcholu a vzdálenost od deterministicky vypočteného bodu v uložené toleranci.
Ruční bod nesmí deklarovat metodu přesnosti `derived`. Skupina má
`ordering=explicit`, 1–10 000 unikátních `point_ids`; v modelové verzi musí
každý člen existovat jako stakeout point a mít stejné CRS. Kódy bodů jsou
unikátní v celé modelové verzi.

Tento slice je již pokrytý TypeScript/Python fixture paritou
`fixtures/contracts/v1/valid-stakeout-model.json` včetně negativních případů
(mimo toleranci, duplicate code/member, chybějící člen, nebezpečný code a
nekonzistentní accuracy). `datamine.model-version-command-batch.v1` nyní
obsahuje `stakeout.point.upsert`, `stakeout.group.upsert`,
`stakeout.group.members.set`, `stakeout.review.set` a
`stakeout.object.remove`; generický API lifecycle je auditovaně aplikuje.
Derived job, renderer a UI zatím nejsou součástí tohoto kontraktového slice a
zůstávají v práci V2-4-05.

## Geometry stream v1

`datamine.geometry-stream-manifest.v1` váže indexed mesh na project, source
version/revision/SHA a object ID. Nese celkové počty, celkovou binární velikost
a finální SHA-256 canonical geometrie. `datamine.geometry-chunk.v1` opakuje
scope, odkazuje na SHA manifestu a přidává sequence/count, globální starts,
nejvýše 4 096 vrcholů, 8 192 faces, 1 MiB payload a vlastní SHA-256.

Chunks jsou ordered transport, nikoli autoritativní model. Přesný replay již
přijaté sekvence je idempotentní; gap, změněný replay, cizí scope nebo checksum
chyba zruší celý partial stream. Limity úplné geometrie jsou 100 000 vrcholů,
200 000 faces a 64 MiB binárního payloadu. TypeScript a Python používají stejné
big-endian float64/uint32 canonical bytes a parity test ověřuje shodný SHA.

Po změně kontraktu regeneruj schémata a spusť oba runtime testy:

```bash
npm run v2:schemas
npm run test --workspace @datamine/contracts
.venv/bin/python -m pytest -q tests/v2/test_contracts.py
```

```bash
npm run v2:schemas
npm run test --workspace @datamine/contracts
```

## Rooms export v1

`datamine.rooms-export.v1` je snapshot přesné immutable `validated` modelové
verze. Nese `project_id`, `document_id`, `model_version_id`, revision,
serverový canonical `model_content_sha256`, `exporter_version`, cílový
`coordinate_space=drawing_m` a explicitní jednotky `m`, `m2`, `m3`. Pole
`rooms` obsahuje všechny room objekty ve stabilním pořadí podle
`properties.number` a `id`; `summary` je autoritativní součet pouze pro
`included` místnosti (včetně objemu `geometric_area_m2 × height_m`).

Python validátor i TypeScript `isContract` navíc kontrolují unikátní room ID,
stabilní pořadí a shodu souhrnu s tolerancí `1e-6`; sdílené JSON Schema omezuje
export na 100 000 rooms a limity hodnot/polygonů zděděné z room kontraktu.
`rooms.export.json` a `rooms.export.xlsx` jsou explicitní varianty
`datamine.job-create.v1` s pevnou exporter verzí a prázdnými parametry.

XLSX není samostatný přenosový kontrakt: jednotky jsou zachované v názvech
sloupců a metadata listu nese identitu modelu, SHA a exporter. JSON je
canonical UTF-8; deterministic ZIP normalizaci a ochranu spreadsheet textu
provádí Python exportér, nikoli TypeBox schéma.

Po změně kontraktu regeneruj schémata a spusť oba runtime testy:

```bash
npm run v2:schemas
npm run test --workspace @datamine/contracts
.venv/bin/python -m pytest -q tests/v2/test_rooms_exports.py
```

## Building quantities v1

`datamine.building-quantities.v1` je autoritativní canonical výsledek jobu
`building.quantities.json` nad přesnou immutable `validated` verzí. Nese source
revision a SHA-256, `drawing_m`, explicitní jednotky, toleranci `1e-6`, řádky
seřazené podle `object_id` a souhrn ověřovaný v TypeScriptu i Pythonu.
`rejected` objekty se nevykazují. Čistá plocha stěny je hrubá boční plocha
minus plochy aktivních otvorů; aktivní otvor bez aktivní hostitelské stěny a
záporný výsledek mimo toleranci jsou chyby. V1 nepřevádí `world_m` ani
`survey_crs`, aby export nemohl tiše změnit souřadný význam.

```bash
npm run v2:schemas
npm run test --workspace @datamine/contracts
.venv/bin/python -m pytest -q tests/v2/test_building_quantities.py
```

## Building export v1

`datamine.building-export.v1` je společný parity payload pro JSON, XLSX a DXF.
Obsahuje pouze nerejected Building objekty seřazené podle ID a jejich přesně
odpovídající quantity řádky. Python i TypeScript odmítnou rozdílné množiny ID,
cizí source document, jiný coordinate space, duplicitní ID nebo neplatný
souhrn. Job varianty `building.export.json|xlsx|dxf` mají jedinou explicitní
verzi `building-export-v1` a žádné volné parametry.

## Civil a stakeout export v1

`datamine.civil-export.v1` a `datamine.stakeout-export.v1` jsou snapshoty přesné
immutable `validated` modelové verze. Oba payloady nesou source document
ID/SHA-256, model version ID/revision/content SHA, exporter verzi,
`coordinate_space=survey_crs`, EPSG CRS s `east_north_up`, metry, vertical datum,
precision `3` desetinná místa / `0.001 m` tolerance a autoritativní summary.
Civil export zahrnuje pouze confirmed `civil.tin_surface`, `civil.axis`,
`civil.profile` a `civil.sweep`; stakeout pouze confirmed body/skupiny. Všechny
objekty musejí sdílet CRS a provenienci; stakeout body navíc procházejí gate
`horizontal_accuracy_m <= 0.05` a `vertical_accuracy_m <= 0.05`.

Joby `civil.export.json|dxf` používají `civil-export-v1`; joby
`stakeout.export.json|csv` používají `stakeout-export-v1`. Parametry jsou v1
prázdné. JSON je canonical UTF-8 (sort keys, kompaktní oddělovače, newline).
CSV je UTF-8 s BOM, CRLF a stabilním pořadím `(code, id)`; souřadnice má na
výstupu tři desetinná místa. TypeScript `isContract` a Python validátor
kontrolují stejnou strukturální a sémantickou hranici. Formátovou paritu
prověřují `tests/v2/test_survey_exports.py` (civil JSON↔DXF a stakeout
JSON↔CSV). DXF je ASCII R2000, v metrech (`$INSUNITS=6`), ve vrstvě
`DATAMINE_CIVIL`; TIN/sweep používá `3DFACE`, osa/profil navazující `LINE` a
entity nesou `DATAMINE` XDATA s ID.

Limity jsou 100 000 civil objektů/bodů, 10 000 skupin, 32 MiB JSON, 64 MiB DXF
a 16 MiB CSV. Formáty nejsou transformací CRS; konzument musí respektovat
explicitní axis order, EPSG a vertical datum.
