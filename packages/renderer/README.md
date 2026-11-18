# Datamine Renderer

Adaptér nad Three.js, který promítá společný verzovaný model do ortografického
2D a perspektivního 3D pohledu. Renderer neukládá doménový stav a vrací pouze
stabilní `object_id` vybraného objektu.

Výchozí resource budget odmítne více než 10 000 objektů nebo 100 000 bodů
napříč vykreslovanými vnějšími polygonovými prstenci. Konfigurované limity se
validují před vytvořením Three.js geometrie; pixel ratio zůstává omezeno na 2.

Balíček záměrně neimportuje žádný modul `rooms`, `civil` ani jejich příkazy.

`RenderableDescriptor` může obsahovat více prism částí pod jedním stabilním
object ID. Renderer před vytvořením Three.js objektů vynucuje unikátní ID,
limity objektů/bodů a konečné rozměry; `dispose` uvolní každou část.

Pokud dostane `DocumentView`, používá v 2D page bounds stránky bez paddingu a
pro vykreslení modelu převádí `drawing_m` zpět do PDF display-space. Exportované
utility `documentPointToDrawing`, `drawingPointToDocument`,
`documentCornersInDrawing` a `invertAffine` jsou čisté a deterministické;
singulární matice se odmítá. 3D režim kalibraci PDF nepoužívá a ponechává
geometrii v `drawing_m`, takže přepnutí režimu nemění objektová ID ani zdrojový
model.

PDF.js ani načítání dokumentů do rendereru nepatří do tohoto balíčku. PDF canvas
je samostatná webová vrstva nad stejným aspect-ratio frame; renderer pouze
vykreslí průhledný 2D WebGL overlay.

Pro `CadUnderlayView` renderer skládá dvě explicitní afinní transformace mezi
PDF display-space, `survey_crs` a `world_m`. Utility vracejí world corners a
ověřitelný inverse roundtrip. V 2D se world descriptor promítne do PDF stránky;
ve 3D podklad zmizí a zdrojový model ani selection se nemění.

Civil `indexed_mesh` descriptor používá stejné object ID pro picking ve 2D i
3D. Ve 2D se Z projekčně položí na nulu, ve 3D se zachová skutečná elevace.
Civil modul před předáním rendereru převádí `survey_crs` přes explicitní CAD
`survey_to_world_xy` a world elevation offset; rozdílné EPSG/datum odmítne.

Point descriptor s volitelným `point: [x,y,z]` a omezeným `pointRadiusM`
renderer vykreslí jako výrazný marker: v 2D položí Z do pevné zobrazovací
roviny, v 3D zachová elevaci a všechny části nesou stejné stabilní picking ID.
3D scéna přidává XY grid, osy a ovládání orbit/pan/zoom; změna kamery nemění
model. `validateDescriptors` kontroluje souřadnice, poloměr i sdílený resource
limit. Inspector skupiny/CRS/provenience zůstává ve webové vrstvě.

`createGeometryStream` a `GeometryStreamAssembler` poskytují bounded transport
velkého indexed mesh. Assembler přijímá pouze následující ordered chunk,
zobrazuje progress a vrátí immutable `RenderableMesh` až po ověření scope,
manifest SHA, všech chunk SHA/velikostí, souvislých offsetů a finálního geometry
SHA. Exact replay je no-op; gap, tamper, kolize nebo cancel vyčistí partial stav.
Malá geometrie prochází stejnou cestou jako jediný chunk.
