# Datamine moduly

Staticky sestavované doménové moduly nad společnými kontrakty a editor core.
Balíček nyní poskytuje veřejnou `rooms.boundary.v1` capability a Building
adapter, který z validated a lidsky potvrzených hranic vytváří auditovatelný
podlahový kandidát. Building neimportuje interní rooms store ani UI.

Registry odmítne chybějící nebo duplicitní capability. Rooms lze registrovat a
spustit bez Buildingu; Building naopak deklaruje svoji závislost explicitně.
Capability vrací hluboce zkopírovanou read-only projekci, odmítá proposal/working
verze a omezuje celkový počet bodů.

Building render adapter vytváří multipart deskriptory pro lomené stěny a
samostatné deskriptory otvorů a podlah. Čistý quantity adapter přijímá pouze
validated verzi, používá stabilní pořadí a pro wall net area odečítá potvrzené
nebo opravené hostované otvory.

Manifest Building modulu deklaruje `building.review.set` a
`building.opening.assign-host`. Host assignment je samostatný auditovatelný
command; obecný object upsert nesmí měnit `host_wall_id`.

Civil manifest je samostatný a registruje `civil.tin_surface` bez závislosti na
Rooms nebo Building. CAD underlay zůstává projekční view kontrakt, nikoli
objekt vlastněný Civil modulem.

Civil dále poskytuje čisté funkce pro stationing, interpolaci podélného profilu
a deterministický sweep. V1 používá vodorovnou XY délku, lineární interpolaci,
levou kolmici k aktuálnímu segmentu a nulový roll. Do sampling množiny vždy
zahrne vrcholy osy a vzorky profilu; extrapolaci a ne-monotónní section offsety
odmítá. Limit 100 000 vrcholů se kontroluje před vytvořením mesh pole.

Nástroj výběru bodů v trase má dva deterministické režimy. Přímka používá
startovní a koncový bod, kolmou XY vzdálenost a nepřijímá body před ani za
úsekem. Režim podél osy promítá každý bod na skutečné segmenty lomené osy,
počítá staničení a znaménkové boční odsazení; tětiva mezi konci osu
nenahrazuje. Oba režimy kontrolují shodné horizontální i vertikální CRS,
neextrapolují, podporují filtr vrstev a výšek a mají omezený počet kandidátů i
výsledků. Kandidátem může být `civil.point` i vytěžený `stakeout.point`, protože
oba typy sdílejí survey souřadnice a explicitní CRS. Výběr je transientní stav
editoru a souřadnice bodů nemění.

`createCivilTinSurfaceFromBoundary` vytváří ruční `civil.tin_surface` z 3 až
2 000 civilních nebo vytěžených vytyčovacích bodů vybraných v pořadí jednoduché hranice. Deterministický ear clipping
podporuje konkávní polygon a zachovává přesné Z vrcholů. Funkce odmítá mixed
CRS, duplicitní XY, self-intersection a degenerovanou plochu. Výsledek je
`unreviewed`, má explicitní provenance a renderer jej zobrazuje jako stejný TIN
mesh ve 2D i 3D. Obecný terrain TIN z vnitřních bodů a breaklines zůstává
samostatným bounded engine jobem; tento interaktivní nástroj jej nenahrazuje.

`createCivilMaterialLayerFromSurface` vytváří pro konstantní tloušťku skutečné
uzavřené 3D těleso: horní TIN, spodní TIN se shodnou XY topologií a opačnou
orientací a triangulované boční stěny odvozené z hraničních hran. Vrstva dědí
CRS a provenienci horního povrchu. Kontrakt i server kontrolují vazbu všech
vrcholů na zdrojový TIN, kladnou omezenou tloušťku, manifold hrany a objem
vypočtený ze signed tetrahedra; klientská hodnota objemu není autoritativní.
Proměnná tloušťka a dvě nezávislé plochy vyžadují společnou triangulaci a nejsou
součástí této etapy.

## Stakeout status (V2-4-05)

`stakeoutModuleManifest` registruje `stakeout.point` a `stakeout.group` bez
závislosti na Rooms/Civil a deklaruje commandy `point.upsert`, `group.upsert`,
`object.remove`, `group.members.set` a `review.set`. `describeStakeoutObjects`
vytváří omezené point markery se stabilním ID, volitelným CAD transformem a
limitem 10 000 bodů. Bez kalibrovaného CAD podkladu odečte společný lokální
survey počátek, aby velké S-JTSK souřadnice neztrácely přesnost ve WebGL.
Velikost markeru se bezpečně odvozuje z rozsahu dat. Unit testy pokrývají
registraci, world mapování, lokální počátek i výběr v přímce.

Modul zatím negeneruje odvozené body z os/profilů/sweep a nemá vlastní job,
persistenci ani export; serverová kontraktová/lifecycle validace zůstává
autoritativní. Skupiny se do rendereru samostatně nepromítají, pouze jejich
členové jako body.
